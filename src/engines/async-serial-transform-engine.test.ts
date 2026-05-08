import { describe, it, expect, vi } from "vitest";
import { AsyncSerialReplacementTransformEngine } from "./async-serial-transform-engine.ts";
import { mockSearchStrategyFactory } from "../../test/utilities.ts";
import type { EngineSink } from "./types.ts";

function collectingSink(): { sink: EngineSink; chunks: string[] } {
  const chunks: string[] = [];
  return {
    sink: { enqueue: (c) => chunks.push(c), error: vi.fn() },
    chunks
  };
}

async function runEngine<TState>(
  engine: AsyncSerialReplacementTransformEngine<TState>,
  inputs: string[]
): Promise<string[]> {
  const { sink, chunks } = collectingSink();
  engine.start(sink);
  for (const input of inputs) await engine.write(input);
  engine.end();
  return chunks;
}

describe("AsyncSerialReplacementTransformEngine", () => {
  describe("non-match passthrough", () => {
    it("passes non-match content to the sink", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "hello " },
        { isMatch: false, content: "world" }
      );
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => "UNUSED"
      });
      expect((await runEngine(engine, ["hello world"])).join("")).toBe("hello world");
    });
  });

  describe("string replacement", () => {
    it("replaces a match with an async string return", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "pre " },
        { isMatch: true, content: "OLD", streamIndices: [4, 7] },
        { isMatch: false, content: " post" }
      );
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => "NEW"
      });
      expect((await runEngine(engine, ["pre OLD post"])).join("")).toBe("pre NEW post");
    });

    it("calls the replacement function with match and context", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "X",
        streamIndices: [0, 1]
      });
      const fn = vi.fn().mockResolvedValue("Y");
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: fn
      });
      await runEngine(engine, ["X"]);
      expect(fn).toHaveBeenCalledWith("X", { matchIndex: 0, streamIndices: [0, 1] });
    });

    it("increments matchIndex across chunks", async () => {
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          yield { isMatch: true, content: "M", streamIndices: [0, 1] as [number, number] };
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((m: string) => m)
      };
      const fn = vi.fn().mockResolvedValue("R");
      const engine = new AsyncSerialReplacementTransformEngine({ searchStrategy: strategy, replacement: fn });
      await runEngine(engine, ["M", "M", "M"]);
      expect(fn).toHaveBeenCalledTimes(3);
      expect(fn).toHaveBeenNthCalledWith(1, "M", expect.objectContaining({ matchIndex: 0 }));
      expect(fn).toHaveBeenNthCalledWith(2, "M", expect.objectContaining({ matchIndex: 1 }));
      expect(fn).toHaveBeenNthCalledWith(3, "M", expect.objectContaining({ matchIndex: 2 }));
    });
  });

  describe("async iterable replacement", () => {
    it("emits all chunks from a returned async iterable", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "X",
        streamIndices: [0, 1]
      });
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => (async function* () { yield "A"; yield "B"; })()
      });
      expect(await runEngine(engine, ["X"])).toEqual(["A", "B"]);
    });

    it("processes matches serially — next match waits for previous iterable to drain", async () => {
      const order: string[] = [];
      let call = 0;
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          yield { isMatch: true, content: `M${call}`, streamIndices: [call, call + 1] as [number, number] };
          call++;
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((m: string) => m)
      };
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async (match) => (async function* () {
          order.push(`start:${match}`);
          await Promise.resolve();
          order.push(`end:${match}`);
          yield match;
        })()
      });
      await runEngine(engine, ["M0", "M1"]);
      expect(order).toEqual(["start:M0", "end:M0", "start:M1", "end:M1"]);
    });
  });

  describe("multi-chunk state", () => {
    it("preserves strategy state across write() calls — partial match completes in later chunk", async () => {
      let call = 0;
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          call++;
          if (call === 1) {
            yield { isMatch: false, content: "text " };
          } else {
            yield { isMatch: true, content: "OLD", streamIndices: [5, 8] as [number, number] };
            yield { isMatch: false, content: " end" };
          }
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((m: string) => m)
      };
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => "NEW"
      });
      const chunks = await runEngine(engine, ["text OL", "D end"]);
      expect(chunks.join("")).toBe("text NEW end");
    });
  });

  describe("multiple matches per chunk", () => {
    it("replaces all matches in a single chunk", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: false, content: "-" },
        { isMatch: true, content: "B", streamIndices: [2, 3] }
      );
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async (m) => m.toLowerCase()
      });
      expect(await runEngine(engine, ["A-B"])).toEqual(["a", "-", "b"]);
    });

    it("emits nothing for a match when async iterable replacement is empty", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "pre " },
        { isMatch: true, content: "X", streamIndices: [4, 5] },
        { isMatch: false, content: " post" }
      );
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => (async function* () {})()
      });
      expect(await runEngine(engine, ["pre X post"])).toEqual(["pre ", " post"]);
    });

    it("accepts a directly-returned AsyncIterable (not just Promise<AsyncIterable>)", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "X",
        streamIndices: [0, 1]
      });
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: () => (async function* () { yield "direct"; })()
      });
      expect(await runEngine(engine, ["X"])).toEqual(["direct"]);
    });

    it("handles multiple matches with different stream replacements", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: false, content: "-" },
        { isMatch: true, content: "B", streamIndices: [2, 3] }
      );
      let call = 0;
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => {
          const chunks = call++ === 0 ? ["X1", "X2"] : ["Y1", "Y2"];
          return (async function* () { yield* chunks; })();
        }
      });
      expect(await runEngine(engine, ["A-B"])).toEqual(["X1", "X2", "-", "Y1", "Y2"]);
    });
  });

  describe("end / flush", () => {
    it("emits strategy tail on end()", async () => {
      const strategy = mockSearchStrategyFactory({ isMatch: false, content: "a" });
      strategy.flush.mockReturnValue("TAIL");
      const engine = new AsyncSerialReplacementTransformEngine({ searchStrategy: strategy, replacement: async () => "R" });
      expect(await runEngine(engine, ["a"])).toEqual(["a", "TAIL"]);
    });
  });

  describe("stopReplacingSignal", () => {
    it("passes chunk through without calling replacement when already aborted", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "X", streamIndices: [0, 1] }
      );
      const fn = vi.fn().mockResolvedValue("R");
      const ac = new AbortController();
      ac.abort();
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: fn,
        stopReplacingSignal: ac.signal
      });
      expect(await runEngine(engine, ["X"])).toEqual(["X"]);
      expect(fn).not.toHaveBeenCalled();
    });

    it("flushes buffered tail on first aborted chunk then passes subsequent chunks through", async () => {
      const strategy = mockSearchStrategyFactory({ isMatch: false, content: "a" });
      strategy.flush.mockReturnValueOnce("BUF").mockReturnValue("");
      const ac = new AbortController();
      ac.abort();
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => "R",
        stopReplacingSignal: ac.signal
      });
      const { sink, chunks } = collectingSink();
      engine.start(sink);
      await engine.write("X");
      await engine.write("Y");
      engine.end();
      expect(chunks).toEqual(["BUF", "X", "Y"]);
    });
  });

  describe("cancel", () => {
    it("stops processing after cancel() is called", async () => {
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          yield { isMatch: true, content: "M", streamIndices: [0, 1] as [number, number] };
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((m: string) => m)
      };
      const fn = vi.fn().mockResolvedValue("R");
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: fn
      });
      const { sink, chunks } = collectingSink();
      engine.start(sink);
      engine.cancel();
      await engine.write("M");
      engine.end();
      expect(chunks).toEqual([]);
      expect(fn).not.toHaveBeenCalled();
      expect(strategy.processChunk).not.toHaveBeenCalled();
    });
  });
});
