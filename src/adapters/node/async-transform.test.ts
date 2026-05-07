import { describe, it, expect, vi } from "vitest";
import { AsyncReplaceContentTransform } from "./async-transform.js";
import { Writable } from "node:stream";
import type { AsyncTransformEngine, EngineSink } from "../../engines/types.js";

function collectWritable(): { writable: Writable; outputs: string[] } {
  const outputs: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      outputs.push(chunk.toString());
      callback();
    }
  });
  return { writable, outputs };
}

function mockAsyncEngine() {
  return {
    start: vi.fn<(sink: EngineSink) => void>(),
    write: vi.fn<(chunk: string) => Promise<void>>().mockResolvedValue(undefined),
    end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancel: vi.fn<() => void>()
  };
}

describe("AsyncReplaceContentTransform (Node async adapter)", () => {
  it("calls engine.start with a sink that pushes to the stream", () => {
    const engine = mockAsyncEngine();
    const transform = new AsyncReplaceContentTransform(engine);
    const { writable, outputs } = collectWritable();

    transform.pipe(writable);
    expect(engine.start).toHaveBeenCalledOnce();
    const [sink] = engine.start.mock.calls[0];
    sink.enqueue("hello");
    expect(outputs).toContain("hello");
  });

  it("decodes incoming Buffer chunks as UTF-8 and passes to engine.write", async () => {
    const engine = mockAsyncEngine();
    const transform = new AsyncReplaceContentTransform(engine);
    const { writable } = collectWritable();

    transform.pipe(writable);
    transform.write(Buffer.from("abc", "utf8"));
    await new Promise((resolve) => transform.end(resolve));

    expect(engine.write).toHaveBeenCalledWith("abc");
  });

  it("calls engine.end on _flush", async () => {
    const engine = mockAsyncEngine();
    const transform = new AsyncReplaceContentTransform(engine);
    const { writable } = collectWritable();

    transform.pipe(writable);
    transform.write("x");
    await new Promise((resolve) => transform.end(resolve));

    expect(engine.end).toHaveBeenCalledOnce();
  });

  it("forwards streamHighWaterMark via TransformOptions", () => {
    const engine: AsyncTransformEngine = {
      start: vi.fn(),
      write: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };
    const transform = new AsyncReplaceContentTransform(engine, { highWaterMark: 7 });
    expect(transform.writableHighWaterMark).toBe(7);
    expect(transform.readableHighWaterMark).toBe(7);
  });

  it("surfaces engine errors as a stream 'error' event via destroy()", async () => {
    const engine: AsyncTransformEngine = {
      start: vi.fn(),
      write: vi.fn().mockRejectedValue(new Error("boom")),
      end: vi.fn().mockResolvedValue(undefined)
    };
    const transform = new AsyncReplaceContentTransform(engine);

    const errored = new Promise<Error>((resolve) =>
      transform.on("error", resolve)
    );
    transform.write("anything");
    transform.on("data", () => {});

    const err = await errored;
    expect(err.message).toBe("boom");
  });

  it("pipes end-to-end: engine output via sink reaches the writable", async () => {
    let capturedSink!: EngineSink;
    const engine: AsyncTransformEngine = {
      start: (sink) => { capturedSink = sink; },
      write: async (chunk) => { capturedSink.enqueue(chunk.toUpperCase()); },
      end: async () => { capturedSink.enqueue("END"); }
    };
    const transform = new AsyncReplaceContentTransform(engine);
    const { writable, outputs } = collectWritable();

    transform.pipe(writable);
    transform.write("abc");
    await new Promise((resolve) => transform.end(resolve));

    expect(outputs).toEqual(["ABC", "END"]);
  });
});
