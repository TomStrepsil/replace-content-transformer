import { describe, it, expect, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { AsyncSerialReplacementTransformEngine } from "./async-serial-transform-engine.ts";
import { RegexSearchStrategy } from "../search-strategies/regex/search-strategy.ts";
import type { MatchResult } from "../../test/utilities.ts";
import {
  abortingOnFirstCall,
  collectEngineSink,
  deferred,
  mockSearchStrategy,
  mockSearchStrategyFactory
} from "../../test/utilities.ts";

async function runEngine<TState, TMatch>(
  engine: AsyncSerialReplacementTransformEngine<TState, TMatch>,
  inputs: string[]
): Promise<string[]> {
  const { sink, chunks } = collectEngineSink();
  engine.start(sink);
  for (const input of inputs) await engine.write(input);
  await engine.end();
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
      const strategy = mockSearchStrategyFactory({ isMatch: true, content: "M", streamIndices: [0, 1] });
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
      const { strategy } = mockSearchStrategy({
        chunk: () => {
          const index = call++;
          return [{ isMatch: true, content: `M${index}`, streamIndices: [index, index + 1] }];
        }
      });
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
      const { strategy } = mockSearchStrategy({
        chunk: () =>
          ++call === 1
            ? [{ isMatch: false, content: "text " }]
            : [
                { isMatch: true, content: "OLD", streamIndices: [5, 8] },
                { isMatch: false, content: " end" }
              ]
      });
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

    it("carries on settling after each match settled at end()", async () => {
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: new RegexSearchStrategy(/x.*y|a/),
        replacement: async (match) => `[${match[0]}]`
      });
      expect((await runEngine(engine, ["x a a x a"])).join("")).toBe("x [a] [a] x [a]");
    });

    it("resolves end() only after a match settled at end() has been replaced", async () => {
      const { strategy } = mockSearchStrategy({
        chunk: [{ isMatch: false, content: "a" }],
        settled: [{ isMatch: true, content: "M", streamIndices: [1, 2] }]
      });
      const gate = deferred<string>();
      const { sink, chunks } = collectEngineSink();
      const engine = new AsyncSerialReplacementTransformEngine({ searchStrategy: strategy, replacement: () => gate.promise });
      engine.start(sink);
      await engine.write("a");

      let ended = false;
      const endPromise = engine.end().then(() => {
        ended = true;
      });
      await setImmediate();
      expect(ended).toBe(false);

      gate.resolve("R");
      await endPromise;
      expect(chunks).toEqual(["a", "R"]);
    });

    it("rejects end() when replacing a match settled at end() fails", async () => {
      const { strategy } = mockSearchStrategy({
        chunk: [{ isMatch: false, content: "a" }],
        settled: [{ isMatch: true, content: "M", streamIndices: [1, 2] }]
      });
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => {
          throw new Error("flush boom");
        }
      });
      engine.start(collectEngineSink().sink);
      await engine.write("a");
      await expect(engine.end()).rejects.toThrow("flush boom");
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
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("X");
      await engine.write("Y");
      engine.end();
      expect(chunks).toEqual(["BUF", "X", "Y"]);
    });
  });

  describe("stopping the search once stopReplacingSignal aborts", () => {
    const match = (content: string): MatchResult => ({
      isMatch: true,
      content,
      streamIndices: [0, 1]
    });
    const nonMatch = (content: string): MatchResult => ({
      isMatch: false,
      content
    });

    it("stops searching once a replacement aborts the signal, and flushes the rest of the chunk", async () => {
      const ac = new AbortController();
      const { strategy, counts } = mockSearchStrategy({
        chunk: [nonMatch("a"), match("1"), nonMatch("b"), match("2"), match("3")],
        rest: "REST"
      });
      const replacement = abortingOnFirstCall(ac, async () => "R");
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });

      expect(await runEngine(engine, ["chunk", "next"])).toEqual([
        "a",
        "R",
        "b23REST",
        "next"
      ]);
      expect(counts.pulled).toBe(2);
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("flushes rather than settles what a strategy holds when the signal aborted before end()", async () => {
      const ac = new AbortController();
      const strategy = mockSearchStrategyFactory(match("x"), nonMatch(" "));
      strategy.settle = vi.fn();
      strategy.flush.mockReturnValueOnce("HELD").mockReturnValue("");
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async () => "R",
        stopReplacingSignal: ac.signal
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);

      await engine.write("chunk");
      ac.abort();
      await engine.end();

      expect(chunks).toEqual(["R", " ", "HELD"]);
      expect(strategy.settle).not.toHaveBeenCalled();
    });

    it("stops settling at end() once a settled match's replacement aborts the signal", async () => {
      const ac = new AbortController();
      const { strategy, counts } = mockSearchStrategy({
        settled: [match("M1"), match("M2"), match("M3")],
        rest: "REST"
      });
      const replacement = abortingOnFirstCall(ac, async () => "R");
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });

      expect(await runEngine(engine, [])).toEqual(["R", "M2M3REST"]);
      expect(counts.pulled).toBe(1);
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("does not replace a match found after the sink aborts the signal mid-scan", async () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({
        chunk: [nonMatch("a"), match("1"), nonMatch("b")],
        rest: "REST"
      });
      const replacement = vi.fn(async () => "R");
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });
      const chunks: string[] = [];
      engine.start({
        enqueue: (chunk) => {
          chunks.push(chunk);
          ac.abort();
        },
        error: () => {}
      });

      await engine.write("chunk");
      await engine.end();

      expect(chunks).toEqual(["a", "1bREST"]);
      expect(replacement).not.toHaveBeenCalled();
    });
  });
  describe("cancel", () => {
    it("stops processing after cancel() is called", async () => {
      const strategy = mockSearchStrategyFactory({ isMatch: true, content: "M", streamIndices: [0, 1] });
      const fn = vi.fn().mockResolvedValue("R");
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: fn
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      engine.cancel();
      await engine.write("M");
      engine.end();
      expect(chunks).toEqual([]);
      expect(fn).not.toHaveBeenCalled();
      expect(strategy.processChunk).not.toHaveBeenCalled();
    });

    it("stops before the next result when cancel() lands while draining", async () => {
      const strategy = mockSearchStrategyFactory<string>(
        { isMatch: false, content: "first" },
        { isMatch: false, content: "second" }
      );
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: () => "R"
      });

      const chunks: string[] = [];
      engine.start({
        enqueue: (chunk: string) => {
          chunks.push(chunk);
          engine.cancel();
        },
        error: () => {}
      });
      await engine.write("input");

      expect(chunks).toEqual(["first"]);
    });

    it("discards a replacement whose own call cancelled the engine", async () => {
      const strategy = mockSearchStrategyFactory<string>(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: false, content: "after" }
      );
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: () => {
          engine.cancel();
          return Promise.resolve("R");
        }
      });

      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("input");

      expect(chunks).toEqual([]);
    });

    it("stops mid-iterable when cancel() lands between yielded replacement chunks", async () => {
      const strategy = mockSearchStrategyFactory<string>({
        isMatch: true,
        content: "M",
        streamIndices: [0, 1]
      });
      const engine = new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: async function* () {
          yield "one";
          engine.cancel();
          yield "two";
        }
      });

      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("input");

      expect(chunks).toEqual(["one"]);
    });
  });
});
