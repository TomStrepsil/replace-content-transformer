import { describe, it, expect, vi } from "vitest";
import { Buffer } from "node:buffer";
import { ReplaceContentTransformer } from "./transformer.js";
import {
  mockAsyncEngine,
  mockSyncEngine,
  mockTransformStreamDefaultControllerFactory,
  startedSinkOf,
  textWrittenTo,
  foreignRealmUtf8,
  inResizableArrayBuffer,
  utf8
} from "../../../test/utilities.js";
import {
  byteStreamOf,
  byteWebAdapter,
  textWebAdapter,
  type WebTransformerFamily,
  type WebChunk
} from "../../../test/web-adapters.js";
import type { ByteEngineSink, EngineSink, TransformEngine } from "../../engines/types.js";

function inSharedArrayBuffer(text: string): SharedArrayBuffer {
  const bytes = utf8(text);
  const shared = new SharedArrayBuffer(bytes.byteLength);
  new Uint8Array(shared).set(bytes);
  return shared;
}

function describeWebAdapter<C extends WebChunk>(family: WebTransformerFamily<C>) {
  describe(`${family.adapter} (web adapter)`, () => {
    it("wires start(controller) to engine.start with a sink that forwards enqueue", () => {
      const engine = mockSyncEngine();
      const transformer = family.create(engine);
      const outputs: C[] = [];
      const controller = mockTransformStreamDefaultControllerFactory(outputs);

      transformer.start(controller);

      expect(engine.start).toHaveBeenCalledOnce();
      const sink = startedSinkOf(engine);
      sink.enqueue("hello");
      expect(outputs.map(family.textOf)).toEqual(["hello"]);
    });

    it("reports delivery as deferred, since readers only receive enqueued chunks through promises", () => {
      const engine = mockSyncEngine();
      const transformer = family.create(engine);
      transformer.start(mockTransformStreamDefaultControllerFactory<C>([]));

      expect(startedSinkOf(engine).deliveryDeferred).toBe(true);
    });

    it("wires start(controller) to engine.start with a sink that forwards error", () => {
      const engine = mockSyncEngine();
      const transformer = family.create(engine);
      const controller = mockTransformStreamDefaultControllerFactory<C>([]);

      transformer.start(controller);

      const sink = startedSinkOf(engine);
      const err = new Error("boom");
      sink.error(err);
      expect(controller.error).toHaveBeenCalledWith(err);
    });

    it("delegates transform(chunk) to engine.write with the chunk's text and returns undefined when the engine does", () => {
      const engine = mockSyncEngine();
      const transformer = family.create(engine);
      transformer.start(mockTransformStreamDefaultControllerFactory<C>([]));

      expect(transformer.transform(family.chunkOf("hello"))).toBeUndefined();
      expect(engine.write).toHaveBeenCalledWith("hello");
    });

    it("delegates transform(chunk) to engine.write with the chunk's text and settles with its promise", async () => {
      const engine = mockAsyncEngine();
      const transformer = family.create(engine);
      transformer.start(mockTransformStreamDefaultControllerFactory<C>([]));

      const promise = transformer.transform(family.chunkOf("hello"));

      expect(engine.write).toHaveBeenCalledWith("hello");
      await expect(promise).resolves.toBeUndefined();
    });

    it("delegates flush() to engine.end() and returns undefined when the engine does", () => {
      const engine = mockSyncEngine();
      const transformer = family.create(engine);
      transformer.start(mockTransformStreamDefaultControllerFactory<C>([]));

      expect(transformer.flush()).toBeUndefined();
      expect(engine.end).toHaveBeenCalledOnce();
    });

    it("delegates flush() to engine.end() and settles with its promise", async () => {
      const engine = mockAsyncEngine();
      const transformer = family.create(engine);
      transformer.start(mockTransformStreamDefaultControllerFactory<C>([]));

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
      const outputs: C[] = [];
      const controller = mockTransformStreamDefaultControllerFactory(outputs);
      const transformer = family.create(engine);

      transformer.start(controller);
      transformer.transform(family.chunkOf("abc"));
      transformer.flush();

      expect(outputs.map(family.textOf)).toEqual(["ABC", "END"]);
    });

    it("calls engine.cancel() when cancel() is called and engine supports it", () => {
      const engine = mockAsyncEngine();
      const transformer = family.create(engine);

      transformer.cancel("test reason");

      expect(engine.cancel).toHaveBeenCalledOnce();
    });

    it("does not throw when cancel() is called on an engine without cancel support", () => {
      const transformer = family.create(mockSyncEngine());

      expect(() => transformer.cancel()).not.toThrow();
    });
  });
}

describeWebAdapter(byteWebAdapter);
describeWebAdapter(textWebAdapter);

describe("ReplaceContentTextTransformer (web adapter) bytes", () => {
  it("leaves acceptsBytes unset, so the engine decodes any bytes a replacement returns before they reach it", () => {
    const engine = mockSyncEngine();
    textWebAdapter.create(engine).start(mockTransformStreamDefaultControllerFactory<string>([]));

    expect(startedSinkOf(engine).acceptsBytes).toBeUndefined();
  });
});

describe("ReplaceContentTransformer (web adapter) UTF-8", () => {
  function startedTransformer<
    E extends ReturnType<typeof mockSyncEngine> | ReturnType<typeof mockAsyncEngine>
  >(engine: E) {
    const transformer = new ReplaceContentTransformer(engine);
    const outputs: Uint8Array[] = [];
    transformer.start(mockTransformStreamDefaultControllerFactory(outputs));
    return { engine, transformer, outputs, sink: startedSinkOf(engine) };
  }

  const textOf = (outputs: Uint8Array[]) =>
    outputs.map((chunk) => new TextDecoder().decode(chunk));

  describe("UTF-8 decoding", () => {
    const text = "a£€😀b";

    it.each(
      Array.from({ length: utf8(text).length + 1 }, (_, splitAt) => ({
        splitAt
      }))
    )(
      "keeps 2-, 3- and 4-byte characters intact when a chunk boundary falls inside one (split at byte $splitAt)",
      ({ splitAt }) => {
        const { engine, transformer } = startedTransformer(mockSyncEngine());
        const bytes = utf8(text);

        transformer.transform(bytes.subarray(0, splitAt));
        transformer.transform(bytes.subarray(splitAt));
        transformer.flush();

        expect(textWrittenTo(engine)).toBe(text);
      }
    );

    it("writes an incomplete trailing sequence to the engine as U+FFFD before engine.end, so no bytes are dropped at the end of the stream", () => {
      const { engine, transformer } = startedTransformer(mockSyncEngine());

      transformer.transform(new Uint8Array([0x61, 0xe2, 0x82]));
      transformer.flush();

      expect(textWrittenTo(engine)).toBe("a\uFFFD");
      expect(engine.write.mock.invocationCallOrder.at(-1)).toBeLessThan(
        engine.end.mock.invocationCallOrder[0]
      );
    });

    it("waits for the engine to accept the trailing sequence before calling engine.end", async () => {
      const { engine, transformer } = startedTransformer(mockAsyncEngine());
      const trailingSequenceWrite = Promise.withResolvers<void>();
      engine.write.mockReturnValueOnce(trailingSequenceWrite.promise);

      await transformer.transform(new Uint8Array([0xe2]));
      const flushed = transformer.flush();
      await vi.waitFor(() => expect(engine.write).toHaveBeenCalledOnce());
      expect(engine.end).not.toHaveBeenCalled();

      trailingSequenceWrite.resolve();
      await flushed;
      expect(engine.end).toHaveBeenCalledOnce();
    });

    it("does not write to the engine on flush when no bytes are pending", () => {
      const { engine, transformer } = startedTransformer(mockSyncEngine());

      transformer.transform(utf8("abc"));
      transformer.flush();

      expect(engine.write).toHaveBeenCalledExactlyOnceWith("abc");
    });

    it("does not write to the engine for a chunk holding only the start of a character", () => {
      const { engine, transformer } = startedTransformer(mockSyncEngine());

      transformer.transform(new Uint8Array([0xe2]));

      expect(engine.write).not.toHaveBeenCalled();
    });

    it.each([
      { name: "in one chunk", chunks: [[0xef, 0xbb, 0xbf, 0x61]] },
      { name: "split across chunks", chunks: [[0xef], [0xbb, 0xbf, 0x61]] }
    ])(
      "enqueues a leading byte order mark ahead of the engine's output, and writes only the text after it to the engine ($name)",
      ({ chunks }) => {
        const { engine, transformer, outputs, sink } = startedTransformer(
          mockSyncEngine()
        );
        engine.write.mockImplementation((text) => sink.enqueue(text));

        for (const chunk of chunks) transformer.transform(new Uint8Array(chunk));

        expect(textWrittenTo(engine)).toBe("a");
        expect(outputs.flatMap((chunk) => [...chunk])).toEqual([
          0xef, 0xbb, 0xbf, 0x61
        ]);
      }
    );

    it("errors the stream when given a string chunk, as from an unmigrated TextDecoderStream", async () => {
      const unmigrated = byteStreamOf([utf8("text")])
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(
          new TransformStream(
            new ReplaceContentTransformer(mockSyncEngine())
          ) as unknown as TransformStream<string, Uint8Array>
        );

      await expect(unmigrated.getReader().read()).rejects.toThrow(TypeError);
    });
  });

  describe("UTF-8 encoding", () => {
    it("enqueues a surrogate pair split across two enqueued chunks as one character", () => {
      const { transformer, outputs, sink } = startedTransformer(mockSyncEngine());

      sink.enqueue("a\uD83D");
      sink.enqueue("\uDE00b");
      transformer.flush();

      expect(textOf(outputs)).toEqual(["a", "😀b"]);
    });

    it("completes a held surrogate pair with a chunk the engine enqueues during end", () => {
      const { engine, transformer, outputs, sink } = startedTransformer(mockSyncEngine());
      engine.end.mockImplementation(() => sink.enqueue("\uDE00b"));

      sink.enqueue("a\uD83D");
      transformer.flush();

      expect(textOf(outputs)).toEqual(["a", "😀b"]);
    });

    it("completes a held surrogate pair with a chunk the engine enqueues during an asynchronous end", async () => {
      const { engine, transformer, outputs, sink } = startedTransformer(mockAsyncEngine());
      engine.end.mockImplementation(async () => sink.enqueue("\uDE00b"));

      sink.enqueue("a\uD83D");
      await transformer.flush();

      expect(textOf(outputs)).toEqual(["a", "😀b"]);
    });

    it("enqueues a high surrogate still held at the end of the stream as U+FFFD, so no output is dropped", () => {
      const { transformer, outputs, sink } = startedTransformer(mockSyncEngine());

      sink.enqueue("a\uD83D");
      transformer.flush();

      expect(textOf(outputs).join("")).toBe("a\uFFFD");
    });

    it("enqueues a high surrogate still held at the end of the stream as U+FFFD once an asynchronous engine.end settles", async () => {
      const { transformer, outputs, sink } = startedTransformer(mockAsyncEngine());

      sink.enqueue("a\uD83D");
      await transformer.flush();

      expect(textOf(outputs).join("")).toBe("a\uFFFD");
    });

    it("accepts bytes from the engine, so a replacement's bytes need not be decoded and encoded again", () => {
      const { sink } = startedTransformer(mockSyncEngine());

      expect(sink.acceptsBytes).toBe(true);
    });

    it("enqueues a copy of bytes from the engine, so a replacement that reuses its buffer can't change output already queued", () => {
      const { transformer, outputs, sink } = startedTransformer(mockSyncEngine());
      const reused = utf8("a");

      (sink as ByteEngineSink).enqueue(reused);
      reused.set(utf8("b"));
      transformer.flush();

      expect(textOf(outputs)).toEqual(["a"]);
    });

    it.each([
      { bytes: "a Uint8Array over a SharedArrayBuffer", of: (text: string) => new Uint8Array(inSharedArrayBuffer(text)) },
      { bytes: "a Node Buffer over a SharedArrayBuffer", of: (text: string) => Buffer.from(inSharedArrayBuffer(text)) },
      { bytes: "bytes in a resizable ArrayBuffer", of: (text: string) => inResizableArrayBuffer(utf8(text)) },
      { bytes: "bytes from another realm, as a fetch body's chunks are for code run in a vm context", of: foreignRealmUtf8 }
    ])("enqueues $bytes from the engine as a copy with a fixed-length ArrayBuffer of its own, which a byte stream can take ownership of and browsers accept as a BufferSource", ({ of }) => {
      const { transformer, outputs, sink } = startedTransformer(mockSyncEngine());

      (sink as ByteEngineSink).enqueue(of("€"));
      transformer.flush();

      expect(outputs[0].buffer).toBeInstanceOf(ArrayBuffer);
      expect((outputs[0].buffer as ArrayBuffer).resizable).toBe(false);
      expect(textOf(outputs)).toEqual(["€"]);
    });

    it("enqueues a high surrogate held before bytes from the engine as U+FFFD, once, since bytes can't complete it", () => {
      const { transformer, outputs, sink } = startedTransformer(mockSyncEngine());

      sink.enqueue("a\uD83D");
      (sink as ByteEngineSink).enqueue(utf8("€"));
      transformer.flush();

      expect(textOf(outputs).join("")).toBe("a\uFFFD€");
    });

    it("emits chunks downstream can transfer, such as by enqueueing each on a byte stream", async () => {
      let capturedSink!: EngineSink;
      const engine: TransformEngine = {
        start: (sink) => { capturedSink = sink; },
        write: (chunk) => { capturedSink.enqueue(chunk); },
        end: () => {}
      };
      const reader = byteStreamOf([utf8("one "), utf8("two")])
        .pipeThrough(new TransformStream(new ReplaceContentTransformer(engine)))
        .getReader();
      const forwarded = new ReadableStream<Uint8Array>({
        type: "bytes",
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        }
      });

      let text = "";
      for await (const chunk of forwarded) text += new TextDecoder().decode(chunk);

      expect(text).toBe("one two");
    });
  });
});
