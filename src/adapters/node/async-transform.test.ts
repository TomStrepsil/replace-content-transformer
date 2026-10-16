import { describe, it, expect, vi } from "vitest";
import { finished } from "node:stream/promises";
import { AsyncReplaceContentTransform } from "./async-transform.js";
import {
  collectWritable,
  deferred,
  mockAsyncEngine,
  startedSinkOf,
  textWrittenTo
} from "../../../test/utilities.js";
import type { AsyncTransformEngine, EngineSink } from "../../engines/types.js";

describe("AsyncReplaceContentTransform (Node async adapter)", () => {
  it("calls engine.start with a sink that pushes to the stream", () => {
    const engine = mockAsyncEngine();
    const transform = new AsyncReplaceContentTransform(engine);
    const { writable, outputs } = collectWritable();

    transform.pipe(writable);
    expect(engine.start).toHaveBeenCalledOnce();
    const sink = startedSinkOf(engine);
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
    const transform = new AsyncReplaceContentTransform(engine, {
      highWaterMark: 7
    });
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
      start: (sink) => {
        capturedSink = sink;
      },
      write: async (chunk) => {
        capturedSink.enqueue(chunk.toUpperCase());
      },
      end: async () => {
        capturedSink.enqueue("END");
      }
    };
    const transform = new AsyncReplaceContentTransform(engine);
    const { writable, outputs } = collectWritable();

    transform.pipe(writable);
    transform.write("abc");
    await new Promise((resolve) => transform.end(resolve));

    expect(outputs).toEqual(["ABC", "END"]);
  });

  it("calls engine.cancel when the stream is destroyed before it ends", () => {
    const engine = mockAsyncEngine();
    const transform = new AsyncReplaceContentTransform(engine);

    transform.write("x");
    transform.destroy();

    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(engine.end).not.toHaveBeenCalled();
  });

  describe("UTF-8 decoding", () => {
    it.each([
      { text: "héllo", splitAt: 2 },
      { text: "a😀b", splitAt: 2 },
      { text: "a😀b", splitAt: 3 },
      { text: "a😀b", splitAt: 4 }
    ])(
      "keeps a multi-byte character intact when a Buffer chunk boundary falls inside it ($text split at byte $splitAt)",
      async ({ text, splitAt }) => {
        const engine = mockAsyncEngine();
        const transform = new AsyncReplaceContentTransform(engine);
        const bytes = Buffer.from(text);

        transform.write(bytes.subarray(0, splitAt));
        transform.write(bytes.subarray(splitAt));
        await new Promise((resolve) => transform.end(resolve));

        expect(textWrittenTo(engine)).toBe(text);
      }
    );

    it("writes an incomplete trailing sequence to the engine as U+FFFD before engine.end, so no bytes are dropped at the end of the stream", async () => {
      const engine = mockAsyncEngine();
      const transform = new AsyncReplaceContentTransform(engine);

      transform.write(Buffer.from([0x61, 0xe2, 0x82]));
      await new Promise((resolve) => transform.end(resolve));

      expect(textWrittenTo(engine)).toBe("a\uFFFD");
      expect(engine.write.mock.invocationCallOrder.at(-1)).toBeLessThan(
        engine.end.mock.invocationCallOrder[0]
      );
    });

    it("waits for the engine to accept the trailing sequence before calling engine.end", async () => {
      const engine = mockAsyncEngine();
      const trailingSequenceWrite = deferred<void>();
      engine.write
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(trailingSequenceWrite.promise);
      const transform = new AsyncReplaceContentTransform(engine);

      transform.write(Buffer.from([0x61, 0xe2, 0x82]));
      const finished = new Promise((resolve) => transform.end(resolve));
      await vi.waitFor(() => expect(engine.write).toHaveBeenCalledTimes(2));
      expect(engine.end).not.toHaveBeenCalled();

      trailingSequenceWrite.resolve();
      await finished;
      expect(engine.end).toHaveBeenCalledOnce();
    });

    it("does not write to the engine on flush when no bytes are pending", async () => {
      const engine = mockAsyncEngine();
      const transform = new AsyncReplaceContentTransform(engine);

      transform.write(Buffer.from("abc"));
      await new Promise((resolve) => transform.end(resolve));

      expect(engine.write).toHaveBeenCalledExactlyOnceWith("abc");
    });

    it("passes string chunks to the engine unchanged when decodeStrings is false, whatever the write() encoding", async () => {
      const engine = mockAsyncEngine();
      const transform = new AsyncReplaceContentTransform(engine, {
        decodeStrings: false
      });

      transform.write("hé", "latin1");
      await new Promise((resolve) => transform.end(resolve));

      expect(textWrittenTo(engine)).toBe("hé");
    });

    it("decodes a dangling partial sequence as U+FFFD ahead of a following string chunk, preserving order when decodeStrings is false", async () => {
      const engine = mockAsyncEngine();
      const transform = new AsyncReplaceContentTransform(engine, {
        decodeStrings: false
      });

      transform.write(Buffer.from([0xc3]));
      transform.write("x");
      await new Promise((resolve) => transform.end(resolve));

      expect(textWrittenTo(engine)).toBe("\uFFFDx");
    });
  });

  describe("UTF-8 encoding", () => {
    it("pushes a surrogate pair split across two enqueued chunks as one character", async () => {
      const engine = mockAsyncEngine();
      const transform = new AsyncReplaceContentTransform(engine);
      const { writable, outputs } = collectWritable();
      transform.pipe(writable);
      const sink = startedSinkOf(engine);

      sink.enqueue("a\uD83D");
      sink.enqueue("\uDE00b");
      transform.end();
      await finished(writable);

      expect(outputs).toEqual(["a", "😀b"]);
    });

    it("completes a held surrogate pair with a chunk the engine enqueues during end", async () => {
      const engine = mockAsyncEngine();
      const transform = new AsyncReplaceContentTransform(engine);
      const { writable, outputs } = collectWritable();
      transform.pipe(writable);
      const sink = startedSinkOf(engine);
      engine.end.mockImplementation(async () => sink.enqueue("\uDE00b"));

      sink.enqueue("a\uD83D");
      transform.end();
      await finished(writable);

      expect(outputs).toEqual(["a", "😀b"]);
    });

    it("pushes a high surrogate still held at the end of the stream as U+FFFD, so no output is dropped", async () => {
      const engine = mockAsyncEngine();
      const transform = new AsyncReplaceContentTransform(engine);
      const { writable, outputs } = collectWritable();
      transform.pipe(writable);
      const sink = startedSinkOf(engine);

      sink.enqueue("a\uD83D");
      transform.end();
      await finished(writable);

      expect(outputs.join("")).toBe("a\uFFFD");
    });
  });
});
