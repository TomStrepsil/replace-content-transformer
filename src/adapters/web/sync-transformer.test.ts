import { describe, it, expect } from "vitest";
import { ReplaceContentTransformer } from "./sync-transformer.js";
import {
  mockSyncEngine,
  mockTransformStreamDefaultControllerFactory
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
    const [sink] = engine.start.mock.calls[0];
    sink.enqueue("hello");
    expect(outputs).toEqual(["hello"]);
  });

  it("wires start(controller) to engine.start with a sink that forwards error", () => {
    const engine = mockSyncEngine();
    const transformer = new ReplaceContentTransformer(engine);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.start(controller);

    const [sink] = engine.start.mock.calls[0];
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
