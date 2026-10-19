import { describe, it, expect } from "vitest";
import { ReplaceContentTransformer } from "./sync-transformer.js";
import {
  mockSyncEngine,
  mockTransformStreamDefaultControllerFactory,
  startedSinkOf
} from "../../../test/utilities.js";
import type { EngineSink, SyncTransformEngine } from "../../engines/types.js";

describe("ReplaceContentTransformer (sync adapter)", () => {
  it("wires start(controller) to engine.start with a sink that forwards enqueue", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.start(controller);

    expect(engine.start).toHaveBeenCalledOnce();
    const sink = startedSinkOf(engine);
    sink.enqueue("hello");
    expect(outputs).toEqual(["hello"]);
  });

  it("wires start(controller) to engine.start with a sink that forwards error", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.start(controller);

    const sink = startedSinkOf(engine);
    const err = new Error("boom");
    sink.error(err);
    expect(controller.error).toHaveBeenCalledWith(err);
  });

  it("delegates transform(chunk) to engine.write(chunk)", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    transformer.transform("hello");

    expect(engine.write).toHaveBeenCalledWith("hello");
  });

  it("delegates flush() to engine.end()", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    transformer.flush();

    expect(engine.end).toHaveBeenCalledOnce();
  });

  it("calls engine.cancel() when cancel() is called and engine supports it", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);

    transformer.cancel("test reason");

    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("does not throw when cancel() is called on an engine without cancel support", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cancel: _unused, ...engineWithoutCancel } = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engineWithoutCancel);

    expect(() => transformer.cancel()).not.toThrow();
  });

  it("calls engine.cancel() when the readable side of a TransformStream is cancelled", async () => {
    const engine = mockSyncEngine();
    const stream = new TransformStream(new ReplaceContentTransformer(engine));

    await stream.readable.cancel("gone");

    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("pipes end-to-end: engine output via sink is forwarded to the controller", () => {
    let capturedSink!: EngineSink;
    const engine: SyncTransformEngine = {
      start: (sink) => { capturedSink = sink; },
      write: (chunk) => { capturedSink.enqueue(chunk.toUpperCase()); },
      end: () => { capturedSink.enqueue("END"); }
    };
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);
    const transformer = new ReplaceContentTransformer(engine);

    transformer.start(controller);
    transformer.transform("abc");
    transformer.flush();

    expect(outputs).toEqual(["ABC", "END"]);
  });
});
