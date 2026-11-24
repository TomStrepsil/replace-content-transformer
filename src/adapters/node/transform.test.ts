import { describe, it, expect, vi } from "vitest";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { ReplaceContentTransform } from "./transform.js";
import {
  collectWritable,
  foreignRealmUtf8,
  mockAsyncEngine,
  mockSyncEngine,
  startedSinkOf,
  textWrittenTo,
  utf8
} from "../../../test/utilities.js";
import type { ByteEngineSink, EngineSink, TransformEngine } from "../../engines/types.js";

describe("ReplaceContentTransform (Node adapter)", () => {
  it("calls engine.start with a sink that pushes to the stream", () => {
    const engine = mockAsyncEngine();
    const transform = new ReplaceContentTransform(engine);
    const { writable, outputs } = collectWritable();

    transform.pipe(writable);
    expect(engine.start).toHaveBeenCalledOnce();
    const sink = startedSinkOf(engine);
    sink.enqueue("hello");
    expect(outputs).toContain("hello");
  });

  it("forwards streamHighWaterMark via TransformOptions", () => {
    const engine: TransformEngine = {
      start: vi.fn(),
      write: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };
    const transform = new ReplaceContentTransform(engine, {
      highWaterMark: 7
    });
    expect(transform.writableHighWaterMark).toBe(7);
    expect(transform.readableHighWaterMark).toBe(7);
  });

  it("cancels the engine when the stream is destroyed before it ends", () => {
    const engine = mockAsyncEngine();
    const transform = new ReplaceContentTransform(engine);

    transform.write("x");
    transform.destroy();

    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(engine.end).not.toHaveBeenCalled();
  });

  it("cancels the engine when the stream is destroyed with an error", async () => {
    const engine = mockAsyncEngine();
    const transform = new ReplaceContentTransform(engine);

    transform.destroy(new Error("downstream failed"));

    const [error] = await once(transform, "error");
    expect(error).toMatchObject({ message: "downstream failed" });
    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("cancels the engine when the stream is destroyed while end() is pending", async () => {
    const engine = mockAsyncEngine();
    const ending = Promise.withResolvers<void>();
    engine.end.mockReturnValue(ending.promise);
    const transform = new ReplaceContentTransform(engine);

    transform.resume();
    transform.end("x");
    await vi.waitFor(() => expect(engine.end).toHaveBeenCalledOnce());
    transform.destroy();

    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("does not cancel the engine when the stream is destroyed after it ends", async () => {
    const engine = mockAsyncEngine();
    const transform = new ReplaceContentTransform(engine);

    transform.resume();
    transform.end("x");
    await finished(transform);

    expect(transform.destroyed).toBe(true);
    expect(engine.cancel).not.toHaveBeenCalled();
  });

  it("reports an AbortError and cancels the engine when constructed with an aborted signal", async () => {
    const engine = mockAsyncEngine();
    const transform = new ReplaceContentTransform(engine, {
      signal: AbortSignal.abort()
    });

    const [error] = await once(transform, "error");
    expect(error).toMatchObject({ name: "AbortError" });
    expect(engine.start).toHaveBeenCalledOnce();
    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("does not cancel the engine when the stream is destroyed between end() and 'finish'", async () => {
    const engine = mockAsyncEngine();
    engine.end.mockImplementation(async () => startedSinkOf(engine).enqueue("LAST"));
    const transform = new ReplaceContentTransform(engine);

    transform.end("x");
    for await (const chunk of transform) if (String(chunk) === "LAST") break;

    expect(transform.writableFinished).toBe(false);
    expect(engine.cancel).not.toHaveBeenCalled();
  });

  it("cancels the engine once when engine.start() reports an error synchronously", async () => {
    const engine = mockAsyncEngine();
    engine.start.mockImplementation((sink) => sink.error(new Error("boom")));
    const transform = new ReplaceContentTransform(engine);

    const [error] = await once(transform, "error");
    expect(error).toMatchObject({ message: "boom" });
    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("reports an error thrown by engine.cancel() when destroyed without an error", async () => {
    const engine = mockAsyncEngine();
    engine.cancel.mockImplementation(() => {
      throw new Error("cancel failed");
    });
    const transform = new ReplaceContentTransform(engine);

    transform.destroy();

    const [error] = await once(transform, "error");
    expect(error).toMatchObject({ message: "cancel failed" });
  });

  it("keeps the destroy error when engine.cancel() also throws", async () => {
    const engine = mockAsyncEngine();
    engine.cancel.mockImplementation(() => {
      throw new Error("cancel failed");
    });
    const transform = new ReplaceContentTransform(engine);

    transform.destroy(new Error("destroyed"));

    const [error] = await once(transform, "error");
    expect(error).toMatchObject({ message: "destroyed" });
  });

  it("keeps the AbortError when engine.cancel() throws for a stream constructed with an aborted signal", async () => {
    const engine = mockAsyncEngine();
    engine.cancel.mockImplementation(() => {
      throw new Error("cancel failed");
    });

    const transform = new ReplaceContentTransform(engine, {
      signal: AbortSignal.abort()
    });

    const [error] = await once(transform, "error");
    expect(error).toMatchObject({ name: "AbortError" });
    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("keeps the engine.start() error when engine.cancel() also throws", async () => {
    const engine = mockAsyncEngine();
    engine.start.mockImplementation((sink) => sink.error(new Error("boom")));
    engine.cancel.mockImplementation(() => {
      throw new Error("cancel failed");
    });

    const transform = new ReplaceContentTransform(engine);

    const [error] = await once(transform, "error");
    expect(error).toMatchObject({ message: "boom" });
    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  describe("the sink's readiness", () => {
    function startedTransform(options?: ConstructorParameters<typeof ReplaceContentTransform>[1]) {
      const engine = mockAsyncEngine();
      const transform = new ReplaceContentTransform(engine, options);
      return { transform, sink: startedSinkOf(engine) as ByteEngineSink, engine };
    }

    it("has ready() return undefined while the readable side has room", () => {
      const { sink } = startedTransform({ readableHighWaterMark: 3 });

      sink.enqueue("ab");

      expect(sink.ready!()).toBeUndefined();
    });

    it.each([
      { output: "text", enqueue: (sink: ByteEngineSink) => sink.enqueue("abc") },
      { output: "bytes", enqueue: (sink: ByteEngineSink) => sink.enqueue(utf8("abc")) }
    ])("has ready() return a Promise once $output it pushes fill the readable side", ({ enqueue }) => {
      const { sink } = startedTransform({ readableHighWaterMark: 3 });

      enqueue(sink);

      expect(sink.ready!()).toBeInstanceOf(Promise);
    });

    it("has ready() return a Promise once the byte order mark it keeps fills the readable side", () => {
      const { transform, sink } = startedTransform({ readableHighWaterMark: 3 });

      transform.write(utf8("\uFEFFabc"));

      expect(sink.ready!()).toBeInstanceOf(Promise);
    });

    it("resolves the Promise from ready() once the readable side is read", async () => {
      const { transform, sink } = startedTransform({ readableHighWaterMark: 3 });
      sink.enqueue("abc");
      const ready = sink.ready!();

      transform.read();

      await expect(ready).resolves.toBeUndefined();
    });

    it("has ready() return undefined once the readable side has been read", () => {
      const { transform, sink } = startedTransform({ readableHighWaterMark: 3 });
      sink.enqueue("abc");

      transform.read();

      expect(sink.ready!()).toBeUndefined();
    });

    it("passes the engine the next chunk once the readable side is read, after a chunk whose output filled it", () => {
      const engine = mockSyncEngine();
      const transform = new ReplaceContentTransform(engine, { readableHighWaterMark: 3 });
      engine.write.mockImplementation(() => startedSinkOf(engine).enqueue("abc"));
      transform.write("1");
      transform.write("2");
      expect(textWrittenTo(engine)).toBe("1");

      transform.read();

      expect(textWrittenTo(engine)).toBe("12");
    });

    it("has room() give the code units, at up to three bytes each, that the readable side can still take", () => {
      const { sink } = startedTransform({ readableHighWaterMark: 30 });

      sink.enqueue("abc");

      expect(sink.room!()).toBe(9);
    });

    it("has room() with readableObjectMode, whose highWaterMark counts chunks, give the chunks the readable side can still take at the code units of the chunk being written", () => {
      const engine = mockSyncEngine();
      const transform = new ReplaceContentTransform(engine, {
        readableObjectMode: true,
        readableHighWaterMark: 3
      });
      const sink = startedSinkOf(engine);
      let room: number | undefined;
      engine.write.mockImplementation(() => {
        sink.enqueue("x");
        room = sink.room!();
      });

      transform.write("ébcd");

      expect(room).toBe(8);
    });

    it("sets roomCountsChunks with readableObjectMode, whose highWaterMark counts chunks", () => {
      const { sink } = startedTransform({ readableObjectMode: true });

      expect(sink.roomCountsChunks).toBe(true);
    });

    it("sets roomCountsChunks to false without readableObjectMode", () => {
      const { sink } = startedTransform();

      expect(sink.roomCountsChunks).toBe(false);
    });
  });

  describe("with an engine that completes each call synchronously", () => {
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

    it("pipes end-to-end: engine output via sink reaches the writable", async () => {
      let capturedSink!: EngineSink;
      const engine: TransformEngine = {
        start: (sink) => {
          capturedSink = sink;
        },
        write: (chunk) => {
          capturedSink.enqueue(chunk.toUpperCase());
        },
        end: () => {
          capturedSink.enqueue("END");
        }
      };
      const transform = new ReplaceContentTransform(engine);
      const { writable, outputs } = collectWritable();

      transform.pipe(writable);
      transform.write("abc");
      await new Promise((resolve) => transform.end(resolve));

      expect(outputs).toEqual(["ABC", "END"]);
    });

    it("surfaces an error the engine throws as a stream 'error' event via destroy()", async () => {
      const engine = mockSyncEngine();
      engine.write.mockImplementation(() => {
        throw new Error("boom");
      });
      const transform = new ReplaceContentTransform(engine);

      transform.write("anything");

      const [error] = await once(transform, "error");
      expect(error).toMatchObject({ message: "boom" });
    });

    it("destroys the stream with an Error when the engine throws a value that is not one", async () => {
      const engine = mockSyncEngine();
      engine.write.mockImplementation(() => {
        throw undefined;
      });
      const transform = new ReplaceContentTransform(engine);

      transform.write("anything");

      const [error] = await once(transform, "error");
      expect(error).toBeInstanceOf(Error);
    });

    describe("UTF-8 decoding", () => {
      it.each([
        { text: "héllo", splitAt: 2 },
        { text: "a😀b", splitAt: 2 },
        { text: "a😀b", splitAt: 3 },
        { text: "a😀b", splitAt: 4 }
      ])(
        "keeps a multi-byte character intact when a Buffer chunk boundary falls inside it ($text split at byte $splitAt)",
        ({ text, splitAt }) => {
          const engine = mockSyncEngine();
          const transform = new ReplaceContentTransform(engine);
          const bytes = Buffer.from(text);

          transform.write(bytes.subarray(0, splitAt));
          transform.write(bytes.subarray(splitAt));
          transform.end();

          expect(textWrittenTo(engine)).toBe(text);
        }
      );

      it("writes an incomplete trailing sequence to the engine as U+FFFD before engine.end, so no bytes are dropped at the end of the stream", () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine);

        transform.write(Buffer.from([0x61, 0xe2, 0x82]));
        transform.end();

        expect(textWrittenTo(engine)).toBe("a\uFFFD");
        expect(engine.write.mock.invocationCallOrder.at(-1)).toBeLessThan(
          engine.end.mock.invocationCallOrder[0]
        );
      });

      it("does not write to the engine on flush when no bytes are pending", () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine);

        transform.write(Buffer.from("abc"));
        transform.end();

        expect(engine.write).toHaveBeenCalledExactlyOnceWith("abc");
      });

      it("passes string chunks to the engine unchanged when decodeStrings is false, whatever the write() encoding", () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine, {
          decodeStrings: false
        });

        transform.write("hé", "latin1");
        transform.end();

        expect(textWrittenTo(engine)).toBe("hé");
      });

      it.each([
        { name: "in one chunk", chunks: [[0xef, 0xbb, 0xbf, 0x61]] },
        { name: "split across chunks", chunks: [[0xef], [0xbb, 0xbf, 0x61]] }
      ])(
        "pushes a leading byte order mark ahead of the engine's output, and writes only the text after it to the engine ($name)",
        async ({ chunks }) => {
          const engine = mockSyncEngine();
          const transform = new ReplaceContentTransform(engine);
          const { writable, outputs } = collectWritable();
          transform.pipe(writable);
          const sink = startedSinkOf(engine);
          engine.write.mockImplementation((text) => sink.enqueue(text));

          for (const chunk of chunks) transform.write(Buffer.from(chunk));
          transform.end();
          await finished(writable);

          expect(textWrittenTo(engine)).toBe("a");
          expect(outputs.join("")).toBe("\uFEFFa");
        }
      );

      it("writes a U+FEFF leading a string chunk to the engine when decodeStrings is false, as the string was decoded upstream", () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine, {
          decodeStrings: false
        });

        transform.write("\uFEFFa");
        transform.end();

        expect(textWrittenTo(engine)).toBe("\uFEFFa");
      });

      it("writes a byte order mark leading a Buffer written after a string chunk to the engine when decodeStrings is false, as it is not at the start of the input", () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine, {
          decodeStrings: false
        });

        transform.write("a");
        transform.write(Buffer.from([0xef, 0xbb, 0xbf, 0x62]));
        transform.end();

        expect(textWrittenTo(engine)).toBe("a\uFEFFb");
      });

      it("decodes a dangling partial sequence as U+FFFD ahead of a following string chunk, preserving order when decodeStrings is false", () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine, {
          decodeStrings: false
        });

        transform.write(Buffer.from([0xc3]));
        transform.write("x");
        transform.end();

        expect(textWrittenTo(engine)).toBe("\uFFFDx");
      });
    });

    describe("UTF-8 encoding", () => {
      it("pushes a surrogate pair split across two enqueued chunks as one character", async () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine);
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
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine);
        const { writable, outputs } = collectWritable();
        transform.pipe(writable);
        const sink = startedSinkOf(engine);
        engine.end.mockImplementation(() => sink.enqueue("\uDE00b"));

        sink.enqueue("a\uD83D");
        transform.end();
        await finished(writable);

        expect(outputs).toEqual(["a", "😀b"]);
      });

      it("pushes a high surrogate still held at the end of the stream as U+FFFD, so no output is dropped", async () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine);
        const { writable, outputs } = collectWritable();
        transform.pipe(writable);
        const sink = startedSinkOf(engine);

        sink.enqueue("a\uD83D");
        transform.end();
        await finished(writable);

        expect(outputs.join("")).toBe("a\uFFFD");
      });

      it("accepts bytes from the engine, so a replacement's bytes need not be decoded and encoded again", () => {
        const engine = mockSyncEngine();
        new ReplaceContentTransform(engine);

        expect(startedSinkOf(engine).acceptsBytes).toBe(true);
      });

      it("does not accept bytes from the engine when readableObjectMode is set, so the engine decodes them", () => {
        const engine = mockSyncEngine();
        new ReplaceContentTransform(engine, { readableObjectMode: true });

        expect(startedSinkOf(engine).acceptsBytes).not.toBe(true);
      });

      it("pushes a copy of bytes from the engine as a Buffer, so a replacement that reuses its buffer can't change output already buffered", async () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine);
        const reused = utf8("a");

        (startedSinkOf(engine) as ByteEngineSink).enqueue(reused);
        reused.set(utf8("b"));
        transform.end();
        const [pushed] = await transform.toArray();

        expect(Buffer.isBuffer(pushed)).toBe(true);
        expect(pushed.toString()).toBe("a");
      });

      it("pushes a copy of bytes from the engine created in another realm, as a fetch body's chunks are for code run in a vm context, such as a Jest test environment", async () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine);

        (startedSinkOf(engine) as ByteEngineSink).enqueue(foreignRealmUtf8("€"));
        transform.end();
        const [pushed] = await transform.toArray();

        expect(Buffer.isBuffer(pushed)).toBe(true);
        expect(pushed.toString()).toBe("€");
      });

      it("pushes a high surrogate held before bytes from the engine as U+FFFD, once, since bytes can't complete it", async () => {
        const engine = mockSyncEngine();
        const transform = new ReplaceContentTransform(engine);
        const { writable, outputs } = collectWritable();
        transform.pipe(writable);
        const sink = startedSinkOf(engine) as ByteEngineSink;

        sink.enqueue("a\uD83D");
        sink.enqueue(utf8("€"));
        transform.end();
        await finished(writable);

        expect(outputs.join("")).toBe("a\uFFFD€");
      });
    });
  });

  describe("with an engine that returns a Promise", () => {
    it("decodes incoming Buffer chunks as UTF-8 and passes to engine.write", async () => {
      const engine = mockAsyncEngine();
      const transform = new ReplaceContentTransform(engine);
      const { writable } = collectWritable();

      transform.pipe(writable);
      transform.write(Buffer.from("abc", "utf8"));
      await new Promise((resolve) => transform.end(resolve));

      expect(engine.write).toHaveBeenCalledWith("abc");
    });

    it("calls engine.end on _flush", async () => {
      const engine = mockAsyncEngine();
      const transform = new ReplaceContentTransform(engine);
      const { writable } = collectWritable();

      transform.pipe(writable);
      transform.write("x");
      await new Promise((resolve) => transform.end(resolve));

      expect(engine.end).toHaveBeenCalledOnce();
    });

    it("surfaces a rejection from the engine as a stream 'error' event via destroy()", async () => {
      const engine: TransformEngine = {
        start: vi.fn(),
        write: vi.fn().mockRejectedValue(new Error("boom")),
        end: vi.fn().mockResolvedValue(undefined)
      };
      const transform = new ReplaceContentTransform(engine);

      const errored = new Promise<Error>((resolve) =>
        transform.on("error", resolve)
      );
      transform.write("anything");
      transform.on("data", () => {});

      const err = await errored;
      expect(err.message).toBe("boom");
    });

    it.each([
      {
        call: "write",
        rejectWithUndefined: (engine: ReturnType<typeof mockAsyncEngine>) =>
          engine.write.mockImplementation(() => Promise.reject(undefined))
      },
      {
        call: "end",
        rejectWithUndefined: (engine: ReturnType<typeof mockAsyncEngine>) =>
          engine.end.mockImplementation(() => Promise.reject(undefined))
      }
    ])("destroys the stream with an Error when engine.$call() rejects with a reason that is not one", async ({ rejectWithUndefined }) => {
      const engine = mockAsyncEngine();
      rejectWithUndefined(engine);
      const transform = new ReplaceContentTransform(engine);

      transform.end("anything");

      const [error] = await once(transform, "error");
      expect(error).toBeInstanceOf(Error);
    });

    it("pipes end-to-end: engine output via sink reaches the writable", async () => {
      let capturedSink!: EngineSink;
      const engine: TransformEngine = {
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
      const transform = new ReplaceContentTransform(engine);
      const { writable, outputs } = collectWritable();

      transform.pipe(writable);
      transform.write("abc");
      await new Promise((resolve) => transform.end(resolve));

      expect(outputs).toEqual(["ABC", "END"]);
    });

    it("passes the next chunk to the engine only once the Promise for the previous one settles", async () => {
      const engine = mockAsyncEngine();
      const firstWrite = Promise.withResolvers<void>();
      engine.write.mockReturnValueOnce(firstWrite.promise);
      const transform = new ReplaceContentTransform(engine);

      transform.write("a");
      transform.write("b");
      await vi.waitFor(() => expect(engine.write).toHaveBeenCalledOnce());
      expect(engine.write).not.toHaveBeenCalledWith("b");

      firstWrite.resolve();
      await vi.waitFor(() => expect(engine.write).toHaveBeenCalledWith("b"));
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
          const transform = new ReplaceContentTransform(engine);
          const bytes = Buffer.from(text);

          transform.write(bytes.subarray(0, splitAt));
          transform.write(bytes.subarray(splitAt));
          await new Promise((resolve) => transform.end(resolve));

          expect(textWrittenTo(engine)).toBe(text);
        }
      );

      it("writes an incomplete trailing sequence to the engine as U+FFFD before engine.end, so no bytes are dropped at the end of the stream", async () => {
        const engine = mockAsyncEngine();
        const transform = new ReplaceContentTransform(engine);

        transform.write(Buffer.from([0x61, 0xe2, 0x82]));
        await new Promise((resolve) => transform.end(resolve));

        expect(textWrittenTo(engine)).toBe("a\uFFFD");
        expect(engine.write.mock.invocationCallOrder.at(-1)).toBeLessThan(
          engine.end.mock.invocationCallOrder[0]
        );
      });

      it("waits for the engine to accept the trailing sequence before calling engine.end", async () => {
        const engine = mockAsyncEngine();
        const trailingSequenceWrite = Promise.withResolvers<void>();
        engine.write
          .mockResolvedValueOnce(undefined)
          .mockReturnValueOnce(trailingSequenceWrite.promise);
        const transform = new ReplaceContentTransform(engine);

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
        const transform = new ReplaceContentTransform(engine);

        transform.write(Buffer.from("abc"));
        await new Promise((resolve) => transform.end(resolve));

        expect(engine.write).toHaveBeenCalledExactlyOnceWith("abc");
      });

      it("passes string chunks to the engine unchanged when decodeStrings is false, whatever the write() encoding", async () => {
        const engine = mockAsyncEngine();
        const transform = new ReplaceContentTransform(engine, {
          decodeStrings: false
        });

        transform.write("hé", "latin1");
        await new Promise((resolve) => transform.end(resolve));

        expect(textWrittenTo(engine)).toBe("hé");
      });

      it("decodes a dangling partial sequence as U+FFFD ahead of a following string chunk, preserving order when decodeStrings is false", async () => {
        const engine = mockAsyncEngine();
        const transform = new ReplaceContentTransform(engine, {
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
        const transform = new ReplaceContentTransform(engine);
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
        const transform = new ReplaceContentTransform(engine);
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
        const transform = new ReplaceContentTransform(engine);
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
});
