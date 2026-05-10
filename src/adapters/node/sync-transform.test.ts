import { describe, it, expect, vi } from "vitest";
import { ReplaceContentTransform } from "./sync-transform.js";
import { collectWritable, mockSyncEngine } from "../../../test/utilities.js";
import type { EngineSink, SyncTransformEngine } from "../../engines/types.js";

describe("ReplaceContentTransform (Node sync adapter)", () => {
  it("calls engine.start with a sink that pushes to the stream", () => {
    const engine = mockSyncEngine();
    const transform = new ReplaceContentTransform(engine);
    const { writable, outputs } = collectWritable();

    transform.pipe(writable);
    expect(engine.start).toHaveBeenCalledOnce();
    const [sink] = engine.start.mock.calls[0];
    sink.enqueue("hello");
    expect(outputs).toContain("hello");
  });

  it("decodes incoming Buffer chunks as UTF-8 and passes to engine.write", () => {
    const engine = mockSyncEngine();
    const transform = new ReplaceContentTransform(engine);
    const { writable } = collectWritable();

    transform.pipe(writable);
    transform.write(Buffer.from("abc", "utf8"));
    transform.end();

    expect(engine.write).toHaveBeenCalledWith("abc");
  });

  it("calls engine.end on _flush", () => {
    const engine = mockSyncEngine();
    const transform = new ReplaceContentTransform(engine);
    const { writable } = collectWritable();

    transform.pipe(writable);
    transform.write("x");
    transform.end();

    expect(engine.end).toHaveBeenCalledOnce();
  });

  it("forwards streamHighWaterMark via TransformOptions", () => {
    const engine: SyncTransformEngine = {
      start: vi.fn(),
      write: vi.fn(),
      end: vi.fn()
    };
    const transform = new ReplaceContentTransform(engine, { highWaterMark: 7 });
    expect(transform.writableHighWaterMark).toBe(7);
    expect(transform.readableHighWaterMark).toBe(7);
  });

  it("pipes end-to-end: engine output via sink reaches the writable", async () => {
    let capturedSink!: EngineSink;
    const engine: SyncTransformEngine = {
      start: (sink) => { capturedSink = sink; },
      write: (chunk) => { capturedSink.enqueue(chunk.toUpperCase()); },
      end: () => { capturedSink.enqueue("END"); }
    };
    const transform = new ReplaceContentTransform(engine);
    const { writable, outputs } = collectWritable();

    transform.pipe(writable);
    transform.write("abc");
    await new Promise((resolve) => transform.end(resolve));

    expect(outputs).toEqual(["ABC", "END"]);
  });
});
