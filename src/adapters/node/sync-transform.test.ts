import { describe, it, expect, vi } from "vitest";
import { ReplaceContentTransform } from "./sync-transform.js";
import {
  collectWritable,
  mockSyncEngine,
  textWrittenTo
} from "../../../test/utilities.js";
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
});
