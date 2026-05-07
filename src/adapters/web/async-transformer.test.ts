import { describe, it, expect, vi } from "vitest";
import { AsyncReplaceContentTransformer } from "./async-transformer.js";
import { mockTransformStreamDefaultControllerFactory } from "../../../test/utilities.js";
import type { AsyncTransformEngine, EngineSink } from "../../engines/types.js";

function mockAsyncEngine() {
  return {
    start: vi.fn<(sink: EngineSink) => void>(),
    write: vi.fn<(chunk: string) => Promise<void>>().mockResolvedValue(undefined),
    end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancel: vi.fn<() => void>()
  };
}

describe("AsyncReplaceContentTransformer (async adapter)", () => {
  it("wires start(controller) to engine.start with a sink that forwards enqueue", () => {
    const engine = mockAsyncEngine();
    const transformer = new AsyncReplaceContentTransformer(engine);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.start(controller);

    expect(engine.start).toHaveBeenCalledOnce();
    const [sink] = engine.start.mock.calls[0];
    sink.enqueue("hello");
    expect(outputs).toEqual(["hello"]);
  });

  it("wires start(controller) to engine.start with a sink that forwards error", () => {
    const engine = mockAsyncEngine();
    const transformer = new AsyncReplaceContentTransformer(engine);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.start(controller);

    const [sink] = engine.start.mock.calls[0];
    const err = new Error("boom");
    sink.error(err);
    expect(controller.error).toHaveBeenCalledWith(err);
  });

  it("delegates transform(chunk) to engine.write(chunk) and returns its promise", async () => {
    const engine = mockAsyncEngine();
    const transformer = new AsyncReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    const promise = transformer.transform("hello");

    expect(engine.write).toHaveBeenCalledWith("hello");
    await expect(promise).resolves.toBeUndefined();
  });

  it("delegates flush() to engine.end() and returns its promise", async () => {
    const engine = mockAsyncEngine();
    const transformer = new AsyncReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    const promise = transformer.flush();

    expect(engine.end).toHaveBeenCalledOnce();
    await expect(promise).resolves.toBeUndefined();
  });

  it("calls engine.cancel() when cancel() is called and engine supports it", () => {
    const engine = mockAsyncEngine();
    const transformer = new AsyncReplaceContentTransformer(engine);

    transformer.cancel("test reason");

    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("does not throw when cancel() is called on an engine without cancel support", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cancel: _unused, ...engineWithoutCancel } = mockAsyncEngine();
    const transformer = new AsyncReplaceContentTransformer(
      engineWithoutCancel as AsyncTransformEngine
    );

    expect(() => transformer.cancel()).not.toThrow();
  });
});
