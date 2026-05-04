import { describe, it, expect, vi } from "vitest";
import { LookaheadAsyncIterableTransformer } from "./lookahead-async-iterable-transformer.ts";
import { SemaphoreStrategy } from "../../lookahead/concurrency-strategy/semaphore-strategy.ts";
import {
  asyncIterable,
  mockSearchStrategyFactory,
  mockTransformStreamDefaultControllerFactory
} from "../../../test/utilities.ts";

// Engine behaviour (scan/schedule/drain, nested re-scanning, backpressure,
// error forwarding, replacement-arg pass-through) is verified directly in
// `src/lookahead/engine.test.ts`. These tests cover only the web-adapter
// wiring: mapping the WHATWG Transformer lifecycle onto the engine and
// forwarding emissions to the TransformStreamDefaultController.

describe("LookaheadAsyncIterableTransformer (web adapter)", () => {
  it("forwards engine emissions to controller.enqueue", async () => {
    const strategy = mockSearchStrategyFactory(
      { isMatch: false, content: "a" },
      { isMatch: false, content: "b" }
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory<string>(outputs);

    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: strategy,
      replacement: async () => asyncIterable(""),
      concurrencyStrategy: new SemaphoreStrategy(1)
    });

    transformer.start(controller);
    await transformer.transform("ab");
    await transformer.flush();

    expect(outputs.join("")).toBe("ab");
    expect(controller.error).not.toHaveBeenCalled();
  });

  it("forwards engine errors to controller.error and rejects flush()", async () => {
    const strategy = mockSearchStrategyFactory({
      isMatch: true,
      content: "M",
      streamIndices: [0, 1]
    });
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory<string>(outputs);

    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: strategy,
      replacement: async () => {
        throw new Error("boom");
      },
      concurrencyStrategy: new SemaphoreStrategy(1)
    });

    transformer.start(controller);
    await transformer.transform("M");
    await expect(transformer.flush()).rejects.toThrow("boom");
    expect(controller.error).toHaveBeenCalledWith(expect.any(Error));
  });

  it("pipes end-to-end through a real TransformStream", async () => {
    // Smoke test that the WHATWG plumbing (start/transform/flush)
    // composes with a real TransformStream, not just the mock controller.
    const strategy = mockSearchStrategyFactory(
      { isMatch: false, content: "pre " },
      { isMatch: true, content: "M", streamIndices: [4, 5] },
      { isMatch: false, content: " post" }
    );
    const replacement = vi.fn(async () => asyncIterable("X"));
    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: strategy,
      replacement,
      concurrencyStrategy: new SemaphoreStrategy(1)
    });

    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("pre M post");
        controller.close();
      }
    }).pipeThrough(new TransformStream(transformer));

    const chunks: string[] = [];
    for await (const chunk of source) chunks.push(chunk);
    expect(chunks.join("")).toBe("pre X post");
  });
});
