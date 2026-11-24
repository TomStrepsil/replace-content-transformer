import { describe, it, expect } from "vitest";
import { setImmediate } from "node:timers/promises";
import { mockAsyncEngine, startedSinkOf, throwing } from "../../../test/utilities.js";
import {
  byteStreamWebAdapter,
  textStreamWebAdapter,
  type WebAdapterFamily,
  type WebChunk
} from "../../../test/web-adapters.js";

const HIGH_WATER_MARK = 64 * 1024;

function describeStreamPair<C extends WebChunk>(family: WebAdapterFamily<C>, bytesPerCodeUnit: number) {
  describe(`${family.adapter} (web adapter)`, () => {
    function startedPair(writableStrategy?: QueuingStrategy<C>, readableStrategy?: QueuingStrategy<C>) {
      const engine = mockAsyncEngine();
      const pair = family.stream(engine, writableStrategy, readableStrategy);
      return { engine, pair, sink: startedSinkOf(engine) };
    }

    it("has ready() return undefined while the readable side has room", () => {
      const { sink } = startedPair();

      sink.enqueue("a".repeat(HIGH_WATER_MARK - 1));

      expect(sink.ready!()).toBeUndefined();
    });

    it("has ready() return a Promise once its output fills the readable side", () => {
      const { sink } = startedPair();

      sink.enqueue("a".repeat(HIGH_WATER_MARK));

      expect(sink.ready!()).toBeInstanceOf(Promise);
    });

    it("resolves the Promise from ready() only once no more than half of what it can hold is left unread", async () => {
      const { pair, sink } = startedPair();
      for (let quarter = 0; quarter < 4; quarter++) sink.enqueue("a".repeat(HIGH_WATER_MARK / 4));
      let resolved = false;
      void sink.ready!()!.then(() => (resolved = true));
      const reader = pair.readable.getReader();

      await reader.read();
      await setImmediate();
      expect(resolved).toBe(false);

      await reader.read();
      await setImmediate();
      expect(resolved).toBe(true);
    });

    it("resolves the Promise from ready() once its output is read", async () => {
      const { pair, sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      const ready = sink.ready!();

      await pair.readable.getReader().read();

      await expect(ready).resolves.toBeUndefined();
    });

    it(`has room() give the code units, at up to ${bytesPerCodeUnit} per code unit, that the readable side can still take`, () => {
      const { sink } = startedPair();

      sink.enqueue("abc");

      expect(sink.room!()).toBe((HIGH_WATER_MARK - 3) / bytesPerCodeUnit);
    });

    it("resolves the Promise from ready() only once no more than half of its readableStrategy's highWaterMark is left unread", async () => {
      const { pair, sink } = startedPair(undefined, new CountQueuingStrategy({ highWaterMark: 4 }));
      for (let chunk = 0; chunk < 4; chunk++) sink.enqueue("a");
      let resolved = false;
      void sink.ready!()!.then(() => (resolved = true));
      const reader = pair.readable.getReader();

      await reader.read();
      await setImmediate();
      expect(resolved).toBe(false);

      await reader.read();
      await setImmediate();
      expect(resolved).toBe(true);
    });

    it("has room(), with a readableStrategy that counts chunks, give the chunks it can still take times the length of the chunk being written", async () => {
      const { pair, sink } = startedPair(undefined, new CountQueuingStrategy({ highWaterMark: 4 }));
      await pair.writable.getWriter().write(family.chunkOf("abc"));

      sink.enqueue("x");

      expect(sink.room!()).toBe(9);
    });

    it.each([
      { strategy: "a CountQueuingStrategy", readableStrategy: new CountQueuingStrategy({ highWaterMark: 4 }) },
      { strategy: "one with no size()", readableStrategy: { highWaterMark: 4 } }
    ])("sets roomCountsChunks with $strategy as its readableStrategy", ({ readableStrategy }) => {
      const { sink } = startedPair(undefined, readableStrategy);

      expect(sink.roomCountsChunks).toBe(true);
    });

    it("sets roomCountsChunks to false with its default readableStrategy", () => {
      const { sink } = startedPair();

      expect(sink.roomCountsChunks).toBe(false);
    });

    it("gives the engine no room() with a CountQueuingStrategy whose size() is its own", () => {
      class SizedByTwos extends CountQueuingStrategy {
        override size = () => 2;
      }
      const { sink } = startedPair(undefined, new SizedByTwos({ highWaterMark: 10 }));

      expect(sink.room).toBeUndefined();
    });

    it("gives the engine no room() with a readableStrategy whose size() counts neither its code units nor chunks", () => {
      const { sink } = startedPair(undefined, { highWaterMark: 10, size: () => 2 });

      expect(sink.room).toBeUndefined();
    });

    it("takes as many chunks before applying backpressure as its writableStrategy allows", () => {
      const { pair } = startedPair(new CountQueuingStrategy({ highWaterMark: 3 }));

      expect(pair.writable.getWriter().desiredSize).toBe(3);
    });

    it("passes the engine no chunk while no read is waiting, with a readable highWaterMark of 0", async () => {
      const { engine, pair } = startedPair(undefined, { highWaterMark: 0 });

      void pair.writable.getWriter().write(family.chunkOf("a"));
      await setImmediate();

      expect(engine.write).not.toHaveBeenCalled();
    });

    it("passes the engine a chunk written while a read is waiting, with a readable highWaterMark of 0", async () => {
      const { engine, pair } = startedPair(undefined, { highWaterMark: 0 });
      void pair.readable.getReader().read();
      await setImmediate();

      void pair.writable.getWriter().write(family.chunkOf("a"));
      await setImmediate();

      expect(engine.write).toHaveBeenCalledWith("a");
    });

    it("has ready() return undefined while a read is waiting that nothing has been enqueued for, with a readable highWaterMark of 0", async () => {
      const { pair, sink } = startedPair(undefined, { highWaterMark: 0 });

      void pair.readable.getReader().read();
      await setImmediate();

      expect(sink.ready!()).toBeUndefined();
    });

    it("has ready() return a Promise once output is enqueued for the read waiting, with a readable highWaterMark of 0", async () => {
      const { pair, sink } = startedPair(undefined, { highWaterMark: 0 });
      void pair.readable.getReader().read();
      await setImmediate();

      sink.enqueue("a");

      expect(sink.ready!()).toBeInstanceOf(Promise);
    });

    it("rejects a write with what the engine's write() fails with", async () => {
      const { engine, pair } = startedPair();
      engine.write.mockRejectedValue(new Error("boom"));

      await expect(pair.writable.getWriter().write(family.chunkOf("a"))).rejects.toThrow("boom");
    });

    it("errors the readable side with what the engine's end() fails with", async () => {
      const { engine, pair } = startedPair();
      engine.end.mockRejectedValue(new Error("boom"));
      void pair.writable.getWriter().close().catch(() => {});

      await expect(pair.readable.getReader().read()).rejects.toThrow("boom");
    });

    it("rejects the next write with what the readableStrategy's size() throws for the engine's output", async () => {
      const { pair, sink } = startedPair(undefined, { highWaterMark: 1, size: throwing(new Error("boom")) });
      const writer = pair.writable.getWriter();
      sink.enqueue("a");

      await expect(writer.write(family.chunkOf("b"))).rejects.toThrow("boom");
    });

    it("cancels the engine once the readableStrategy's size() throws for its output", () => {
      const { engine, sink } = startedPair(undefined, { highWaterMark: 1, size: throwing(new Error("boom")) });

      sink.enqueue("a");

      expect(engine.cancel).toHaveBeenCalledOnce();
    });

    it("rejects a write waiting for room with what the engine errors the stream with", async () => {
      const { pair, sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      const written = pair.writable.getWriter().write(family.chunkOf("b"));
      await setImmediate();

      sink.error(new Error("boom"));

      await expect(written).rejects.toThrow("boom");
    });

    it("passes the engine no chunk from a write waiting for room once the engine errors the stream", async () => {
      const { engine, pair, sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      void pair.writable.getWriter().write(family.chunkOf("b")).catch(() => {});
      await setImmediate();

      sink.error(new Error("boom"));
      await setImmediate();

      expect(engine.write).not.toHaveBeenCalled();
    });

    it("resolves a Promise from ready() once the engine errors the stream", async () => {
      const { sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      const ready = sink.ready!();

      sink.error(new Error("boom"));

      await expect(ready).resolves.toBeUndefined();
    });

    it.each([
      { when: "", writing: false },
      { when: " while the engine's write() is under way", writing: true }
    ])("rejects abort() with what the engine's cancel() throws$when", async ({ writing }) => {
      const { engine, pair } = startedPair();
      engine.cancel.mockImplementation(throwing(new Error("cancel failed")));
      const writeUnderWay = Promise.withResolvers<void>();
      engine.write.mockReturnValue(writeUnderWay.promise);
      const writer = pair.writable.getWriter();
      if (writing) {
        void writer.write(family.chunkOf("a")).catch(() => {});
        await setImmediate();
      }

      const aborted = writer.abort("stop");
      writeUnderWay.resolve();

      await expect(aborted).rejects.toThrow("cancel failed");
    });

    it("cancels the engine when the writable side is aborted", async () => {
      const { engine, pair } = startedPair();

      await pair.writable.abort("stop");

      expect(engine.cancel).toHaveBeenCalledOnce();
    });

    it("errors the readable side with the reason the writable side is aborted with", async () => {
      const { pair } = startedPair();

      await pair.writable.abort("stop");

      await expect(pair.readable.getReader().read()).rejects.toBe("stop");
    });

    it("cancels the engine when the writable side is aborted while the engine's write() is under way", async () => {
      const { engine, pair } = startedPair();
      engine.write.mockReturnValue(new Promise(() => {}));
      const writer = pair.writable.getWriter();
      void writer.write(family.chunkOf("a"));
      await setImmediate();

      void writer.abort("stop");
      await setImmediate();

      expect(engine.cancel).toHaveBeenCalledOnce();
    });

    it("errors the readable side with the reason the writable side is aborted with while the engine's write() is under way", async () => {
      const { engine, pair } = startedPair();
      engine.write.mockReturnValue(new Promise(() => {}));
      const writer = pair.writable.getWriter();
      void writer.write(family.chunkOf("a"));
      await setImmediate();

      void writer.abort("stop");

      await expect(pair.readable.getReader().read()).rejects.toBe("stop");
    });

    it("passes the engine no chunk from a write waiting for room once the writable side is aborted", async () => {
      const { engine, pair, sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      const writer = pair.writable.getWriter();
      void writer.write(family.chunkOf("b")).catch(() => {});
      await setImmediate();

      void writer.abort("stop").catch(() => {});
      await setImmediate();

      expect(engine.write).not.toHaveBeenCalled();
    });

    it("rejects a write waiting for room with the reason its output is cancelled with", async () => {
      const { pair, sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      const written = pair.writable.getWriter().write(family.chunkOf("b"));
      await setImmediate();

      await pair.readable.cancel("stop");

      await expect(written).rejects.toBe("stop");
    });

    it("passes the engine no chunk from a write waiting for room once its output is cancelled", async () => {
      const { engine, pair, sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      void pair.writable.getWriter().write(family.chunkOf("b")).catch(() => {});
      await setImmediate();

      await pair.readable.cancel("stop");
      await setImmediate();

      expect(engine.write).not.toHaveBeenCalled();
    });

    it("resolves close() when its output is cancelled while it flushes", async () => {
      const { engine, pair } = startedPair();
      const flushing = Promise.withResolvers<void>();
      engine.end.mockReturnValue(flushing.promise);
      const closed = pair.writable.getWriter().close();
      await setImmediate();

      await pair.readable.cancel("stop");
      flushing.resolve();

      await expect(closed).resolves.toBeUndefined();
    });

    it("cancels its source once its output is cancelled while it waits to pass the engine the next chunk", async () => {
      const { pair, sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      const sourceCancelled = Promise.withResolvers<void>();
      const readable = new ReadableStream<C>({
        start: (controller) => controller.enqueue(family.chunkOf("b")),
        cancel: () => sourceCancelled.resolve()
      }).pipeThrough(pair);
      await setImmediate();

      await readable.cancel();

      await expect(sourceCancelled.promise).resolves.toBeUndefined();
    });

    it("passes the engine no further chunk while the readable side is full, until it is read", async () => {
      const { engine, pair, sink } = startedPair();
      sink.enqueue("a".repeat(HIGH_WATER_MARK));
      const writer = pair.writable.getWriter();

      void writer.write(family.chunkOf("b"));
      await setImmediate();
      expect(engine.write).not.toHaveBeenCalled();

      await pair.readable.getReader().read();
      await setImmediate();
      expect(engine.write).toHaveBeenCalledWith("b");
    });
  });
}

describeStreamPair(byteStreamWebAdapter, 3);
describeStreamPair(textStreamWebAdapter, 1);

describe("ReplaceContentStream (web adapter), with a ByteLengthQueuingStrategy of its own", () => {
  it("has room() give the code units, at up to 3 per code unit, that the readable side can still take", () => {
    const engine = mockAsyncEngine();
    byteStreamWebAdapter.stream(engine, undefined, new ByteLengthQueuingStrategy({ highWaterMark: 30 }));
    const sink = startedSinkOf(engine);

    sink.enqueue("abc");

    expect(sink.room!()).toBe(9);
  });

  it("gives the engine no room() when its size() is its own", () => {
    class SizedByHundreds extends ByteLengthQueuingStrategy {
      override size = () => 100;
    }
    const engine = mockAsyncEngine();
    byteStreamWebAdapter.stream(engine, undefined, new SizedByHundreds({ highWaterMark: 100 }));

    expect(startedSinkOf(engine).room).toBeUndefined();
  });

  it("sets roomCountsChunks to false", () => {
    const engine = mockAsyncEngine();
    byteStreamWebAdapter.stream(engine, undefined, new ByteLengthQueuingStrategy({ highWaterMark: 30 }));

    expect(startedSinkOf(engine).roomCountsChunks).toBe(false);
  });
});
