import { describe, it, expect } from "vitest";
import { ReplaceContentTransformer } from "./transformer.js";
import {
  mockAsyncEngine,
  mockSyncEngine,
  mockTransformStreamDefaultControllerFactory,
  startedSinkOf
} from "../../../test/utilities.js";
import type { EngineSink, TransformEngine } from "../../engines/types.js";

describe("ReplaceContentTransformer (web adapter)", () => {
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

  it("reports delivery as deferred, since readers only receive enqueued chunks through promises", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    expect(startedSinkOf(engine).deliveryDeferred).toBe(true);
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

  it("delegates transform(chunk) to engine.write(chunk) and returns undefined when the engine does", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    expect(transformer.transform("hello")).toBeUndefined();
    expect(engine.write).toHaveBeenCalledWith("hello");
  });

  it("delegates transform(chunk) to engine.write(chunk) and returns its promise", async () => {
    const engine = mockAsyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    const promise = transformer.transform("hello");

    expect(engine.write).toHaveBeenCalledWith("hello");
    await expect(promise).resolves.toBeUndefined();
  });

  it("delegates flush() to engine.end() and returns undefined when the engine does", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    expect(transformer.flush()).toBeUndefined();
    expect(engine.end).toHaveBeenCalledOnce();
  });

  it("delegates flush() to engine.end() and returns its promise", async () => {
    const engine = mockAsyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    transformer.start(mockTransformStreamDefaultControllerFactory([]));

    const promise = transformer.flush();

    expect(engine.end).toHaveBeenCalledOnce();
    await expect(promise).resolves.toBeUndefined();
  });

  it("pipes end-to-end: engine output via sink is forwarded to the controller", () => {
    let capturedSink!: EngineSink;
    const engine: TransformEngine = {
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

  it("calls engine.cancel() when cancel() is called and engine supports it", () => {
    const engine = mockAsyncEngine();
    const transformer = new ReplaceContentTransformer(engine);

    transformer.cancel("test reason");

    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("does not throw when cancel() is called on an engine without cancel support", () => {
    const transformer = new ReplaceContentTransformer(mockSyncEngine());

    expect(() => transformer.cancel()).not.toThrow();
  });
});
