import { describe, it, expect, vi } from "vitest";
import { SyncReplacementTransformEngine } from "./sync-transform-engine.ts";
import type { MatchResult } from "../../test/utilities.ts";
import {
  abortingOnFirstCall,
  collectEngineSink,
  mockSearchStrategy,
  mockSearchStrategyFactory
} from "../../test/utilities.ts";

function runEngine<TState>(
  engine: SyncReplacementTransformEngine<TState>,
  inputs: string[]
): string[] {
  const { sink, chunks } = collectEngineSink();
  engine.start(sink);
  for (const input of inputs) engine.write(input);
  engine.end();
  return chunks;
}

function outputOf<TState>(
  engine: SyncReplacementTransformEngine<TState>,
  inputs: string[]
): string {
  return runEngine(engine, inputs).join("");
}

describe("SyncTransformEngine", () => {
  describe("non-match passthrough", () => {
    it("passes non-match content to the sink", () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "hello " },
        { isMatch: false, content: "world" }
      );
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: () => "UNUSED"
      });
      expect(outputOf(engine, ["hello world"])).toBe("hello world");
    });
  });

  describe("string replacement", () => {
    it("replaces a match with a static string", () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "pre " },
        { isMatch: true, content: "OLD", streamIndices: [4, 7] },
        { isMatch: false, content: " post" }
      );
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "NEW"
      });
      expect(outputOf(engine, ["pre OLD post"])).toBe("pre NEW post");
    });

    it("replaces with the function return value", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "X",
        streamIndices: [0, 1]
      });
      const fn = vi.fn().mockReturnValue("Y");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: fn
      });
      runEngine(engine, ["X"]);
      expect(fn).toHaveBeenCalledWith("X", {
        matchIndex: 0,
        streamIndices: [0, 1]
      });
    });

    it("increments matchIndex across chunks", () => {
      let call = 0;
      const { strategy } = mockSearchStrategy({
        chunk: () => {
          const start = call++ * 10;
          return [{ isMatch: true, content: "M", streamIndices: [start, start + 1] }];
        }
      });
      const fn = vi.fn().mockReturnValue("R");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: fn
      });
      runEngine(engine, ["M", "M", "M"]);
      expect(fn).toHaveBeenNthCalledWith(
        1,
        "M",
        expect.objectContaining({ matchIndex: 0 })
      );
      expect(fn).toHaveBeenNthCalledWith(
        2,
        "M",
        expect.objectContaining({ matchIndex: 1 })
      );
      expect(fn).toHaveBeenNthCalledWith(
        3,
        "M",
        expect.objectContaining({ matchIndex: 2 })
      );
    });
  });

  describe("iterable replacement", () => {
    it("emits all items from an iterable return value", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "X",
        streamIndices: [0, 1]
      });
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: () => ["A", "B", "C"]
      });
      expect(outputOf(engine, ["X"])).toBe("ABC");
    });

    it("emits items from a generator return value", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "X",
        streamIndices: [0, 1]
      });
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: function* () {
          yield "P";
          yield "Q";
        }
      });
      expect(outputOf(engine, ["X"])).toBe("PQ");
    });
  });

  describe("multi-chunk state", () => {
    it("preserves strategy state across write() calls — partial match completes in later chunk", () => {
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
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "NEW"
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      engine.write("text OL");
      engine.write("D end");
      engine.end();
      expect(chunks.join("")).toBe("text NEW end");
    });

    it("handles a match at the very start of a chunk", () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "HELLO", streamIndices: [0, 5] },
        { isMatch: false, content: " world" }
      );
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "HI"
      });
      expect(outputOf(engine, ["HELLO world"])).toBe("HI world");
    });
  });

  describe("multiple matches per chunk", () => {
    it("replaces all matches in a single chunk", () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: false, content: "-" },
        { isMatch: true, content: "B", streamIndices: [2, 3] }
      );
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "X"
      });
      expect(outputOf(engine, ["A-B"])).toBe("X-X");
    });

    it("replaces with different iterable per match index", () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: false, content: "-" },
        { isMatch: true, content: "M", streamIndices: [2, 3] }
      );
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: (_match, ctx) => [
          `${ctx.matchIndex}a`,
          `${ctx.matchIndex}b`
        ]
      });
      expect(outputOf(engine, ["M-M"])).toBe("0a0b-1a1b");
    });

    it("emits nothing for a match when replacement returns an empty iterable", () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "pre " },
        { isMatch: true, content: "X", streamIndices: [4, 5] },
        { isMatch: false, content: " post" }
      );
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: () => []
      });
      expect(outputOf(engine, ["pre X post"])).toBe("pre  post");
    });
  });

  describe("end / flush", () => {
    it("emits strategy tail on end()", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      strategy.flush.mockReturnValue("TAIL");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "R"
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      engine.write("a");
      const written = chunks.join("");
      engine.end();
      expect(chunks.join("")).toBe(`${written}TAIL`);
    });

    it("emits nothing on end() when flush returns empty string", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      strategy.flush.mockReturnValue("");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "R"
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      engine.write("a");
      const enqueuedBeforeEnd = chunks.length;
      engine.end();
      expect(chunks).toHaveLength(enqueuedBeforeEnd);
    });
  });

  describe("settle and flush around an abort", () => {
    it("flushes the held text, without settling it, on the first aborted chunk", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "unused"
      });
      strategy.settle = vi.fn();
      strategy.flush.mockReturnValueOnce("before MATCH").mockReturnValue("");

      const replacement = vi.fn().mockReturnValue("R");
      const ac = new AbortController();
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });

      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      ac.abort();
      engine.write("passthrough");
      engine.end();

      expect(chunks.join("")).toBe("before MATCHpassthrough");
      expect(strategy.settle).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
    });

    it("flushes rather than settles at end() when the signal aborted after the last chunk", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      strategy.settle = vi.fn();
      strategy.flush.mockReturnValue("xMATCH");

      const replacement = vi.fn().mockReturnValue("R");
      const ac = new AbortController();
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });

      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      engine.write("a");
      ac.abort();
      engine.end();

      expect(chunks.join("")).toBe("axMATCH");
      expect(strategy.settle).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
    });

    it("applies the replacement to a match settled by end() when nothing aborted", () => {
      const { strategy } = mockSearchStrategy({
        chunk: [{ isMatch: false, content: "a" }],
        settled: [{ isMatch: true, content: "MATCH", streamIndices: [1, 6] }]
      });

      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "R"
      });

      expect(outputOf(engine, ["a"])).toBe("aR");
    });

    it("drops an empty flush rather than enqueuing an empty chunk", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });

      const ac = new AbortController();
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "R",
        stopReplacingSignal: ac.signal
      });

      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      ac.abort();
      engine.write("passthrough");
      engine.end();

      expect(chunks).not.toContain("");
    });
  });

  describe("stopReplacingSignal", () => {
    it("passes chunk through without calling replacement when already aborted", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "X",
        streamIndices: [0, 1]
      });
      const fn = vi.fn().mockReturnValue("R");
      const ac = new AbortController();
      ac.abort();
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: fn,
        stopReplacingSignal: ac.signal
      });
      expect(outputOf(engine, ["X"])).toBe("X");
      expect(fn).not.toHaveBeenCalled();
    });

    it("flushes buffered tail once on first aborted chunk, then passes subsequent chunks through", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      // Real strategy: returns buffer on first flush, then "" once consumed.
      strategy.flush.mockReturnValueOnce("BUF").mockReturnValue("");
      const ac = new AbortController();
      ac.abort();
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "R",
        stopReplacingSignal: ac.signal
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      engine.write("X");
      engine.write("Y");
      engine.end();
      expect(chunks.join("")).toBe("BUFXY");
    });

    it("stops replacement mid-chunk when signal is aborted inside the replacement fn", () => {
      const ac = new AbortController();
      let call = 0;
      const { strategy } = mockSearchStrategy({
        chunk: [
          { isMatch: true, content: "A", streamIndices: [0, 1] },
          { isMatch: true, content: "B", streamIndices: [1, 2] }
        ]
      });
      const fn = vi.fn().mockImplementation(() => {
        if (call++ === 0) ac.abort();
        return "R";
      });
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: fn,
        stopReplacingSignal: ac.signal
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      engine.write("AB");
      engine.end();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(chunks.join("")).toBe("RB");
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

    it("stops searching once a replacement aborts the signal, and flushes the rest of the chunk", () => {
      const ac = new AbortController();
      const { strategy, counts } = mockSearchStrategy({
        chunk: [nonMatch("a"), match("1"), nonMatch("b"), match("2"), match("3")],
        rest: "REST"
      });
      const replacement = abortingOnFirstCall(ac, () => "R");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });

      expect(outputOf(engine, ["chunk", "next"])).toBe("aRb23RESTnext");
      expect(counts.pulled).toBe(2);
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("stops settling at end() once a settled match's replacement aborts the signal", () => {
      const ac = new AbortController();
      const { strategy, counts } = mockSearchStrategy({
        settled: [match("M1"), match("M2"), match("M3")],
        rest: "REST"
      });
      const replacement = abortingOnFirstCall(ac, () => "R");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });

      expect(outputOf(engine, [])).toBe("RM2M3REST");
      expect(counts.pulled).toBe(1);
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("does not replace a match found after the sink aborts the signal mid-scan", () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({
        chunk: [nonMatch("a"), match("1"), nonMatch("b")],
        rest: "REST"
      });
      const replacement = vi.fn(() => "R");
      const engine = new SyncReplacementTransformEngine({
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

      engine.write("chunk");
      engine.end();

      expect(chunks.join("")).toBe("a1bREST");
      expect(replacement).not.toHaveBeenCalled();
    });

    it("does not call the replacement again once the sink aborts the signal on a replacement's output", () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({
        chunk: [match("1"), nonMatch("b"), match("2"), nonMatch("c")],
        rest: "REST"
      });
      const replacement = vi.fn(() => "R");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });
      const chunks: string[] = [];
      engine.start({
        enqueue: (chunk) => {
          chunks.push(chunk);
          if (chunk.includes("R")) ac.abort();
        },
        error: () => {}
      });

      engine.write("chunk");
      engine.end();

      expect(chunks.join("")).toBe("Rb2cREST");
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("lets an iterable replacement see the sink abort the signal on one of its pieces before it yields the next", () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({
        chunk: [match("1"), nonMatch("b"), match("2")],
        rest: "REST"
      });
      const replacement = vi.fn(function* () {
        yield "A";
        yield ac.signal.aborted ? "B" : "C";
      });
      const engine = new SyncReplacementTransformEngine({
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

      engine.write("chunk");
      engine.end();

      expect(chunks.join("")).toBe("ABb2REST");
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("ends an iterable replacement that yields until the sink aborts the signal", () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({ chunk: [match("1")] });
      const yieldsUntilAborted = function* () {
        for (let piece = 0; piece < 100 && !ac.signal.aborted; piece++) yield "x";
      };
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: yieldsUntilAborted,
        stopReplacingSignal: ac.signal
      });
      const chunks: string[] = [];
      engine.start({
        enqueue: (chunk) => {
          chunks.push(chunk);
          if (chunks.join("").length === 3) ac.abort();
        },
        error: () => {}
      });

      engine.write("chunk");
      engine.end();

      expect(chunks.join("")).toBe("xxx");
    });
  });

  describe("one output chunk per call", () => {
    const match = (content: string, start: number): MatchResult => ({
      isMatch: true,
      content,
      streamIndices: [start, start + 1]
    });
    const nonMatch = (content: string): MatchResult => ({
      isMatch: false,
      content
    });

    it("enqueues once per write() and once per end(), however many results each reports", () => {
      const { strategy } = mockSearchStrategy({
        chunk: (haystack) => [
          nonMatch(`<${haystack}>`),
          match("M", 0),
          nonMatch("-"),
          match("M", 2)
        ],
        settled: [match("S", 0), nonMatch("."), match("S", 2)]
      });
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: (content) => [content.toLowerCase(), "!"]
      });

      expect(runEngine(engine, ["1", "2"])).toEqual([
        "<1>m!-m!",
        "<2>m!-m!",
        "s!.s!"
      ]);
    });

    it.each([
      { deferred: undefined, expected: ["a", "R", "b", "R"] },
      { deferred: false, expected: ["a", "R", "b", "R"] },
      { deferred: true, expected: ["aRbR"] }
    ])(
      "with a stopReplacingSignal, enqueues before and after each replacement unless the sink reports delivery as deferred ($deferred)",
      ({ deferred, expected }) => {
        const { strategy } = mockSearchStrategy({
          chunk: [nonMatch("a"), match("1", 1), nonMatch("b"), match("2", 3)]
        });
        const engine = new SyncReplacementTransformEngine({
          searchStrategy: strategy,
          replacement: "R",
          stopReplacingSignal: new AbortController().signal
        });
        const { sink, chunks } = collectEngineSink();
        engine.start(
          deferred === undefined ? sink : { ...sink, deliveryDeferred: deferred }
        );

        engine.write("a1b2");
        engine.end();

        expect(chunks).toEqual(expected);
      }
    );

    it.each([
      { deferred: undefined, expected: ["a", "P", "Q", "b"] },
      { deferred: false, expected: ["a", "P", "Q", "b"] },
      { deferred: true, expected: ["aPQb"] }
    ])(
      "with a stopReplacingSignal, enqueues each piece of an iterable replacement unless the sink reports delivery as deferred ($deferred)",
      ({ deferred, expected }) => {
        const { strategy } = mockSearchStrategy({
          chunk: [nonMatch("a"), match("1", 1), nonMatch("b")]
        });
        const engine = new SyncReplacementTransformEngine({
          searchStrategy: strategy,
          replacement: () => ["P", "Q"],
          stopReplacingSignal: new AbortController().signal
        });
        const { sink, chunks } = collectEngineSink();
        engine.start(
          deferred === undefined ? sink : { ...sink, deliveryDeferred: deferred }
        );

        engine.write("a1b");
        engine.end();

        expect(chunks).toEqual(expected);
      }
    );

    it("stops at the replacement that aborts the signal when the sink reports delivery as deferred", () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({
        chunk: [nonMatch("a"), match("1", 1), nonMatch("b"), match("2", 3)],
        rest: "REST"
      });
      const replacement = abortingOnFirstCall(ac, () => "R");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement,
        stopReplacingSignal: ac.signal
      });
      const { sink, chunks } = collectEngineSink();
      engine.start({ ...sink, deliveryDeferred: true });

      engine.write("a1b2");
      engine.end();

      expect(chunks.join("")).toBe("aRb2REST");
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("enqueues nothing for a call whose output is empty", () => {
      const { strategy } = mockSearchStrategy({
        chunk: [match("X", 0), match("Y", 1)],
        settled: [match("Z", 2)]
      });
      const { sink } = collectEngineSink();
      const enqueue = vi.spyOn(sink, "enqueue");
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: ""
      });
      engine.start(sink);

      engine.write("XY");
      engine.end();

      expect(enqueue).not.toHaveBeenCalled();
    });

    it.each([
      {
        thrower: "a replacement function",
        replacement: (content: string) => {
          if (content === "2") throw new Error("boom");
          return "R";
        },
        expected: "xRy"
      },
      {
        thrower: "an iterable replacement",
        replacement: function* (content: string) {
          yield `${content}a`;
          if (content === "2") throw new Error("boom");
          yield `${content}b`;
        },
        expected: "x1a1by2a"
      }
    ])("still enqueues the output produced before $thrower throws", ({ replacement, expected }) => {
      const { strategy } = mockSearchStrategy({
        chunk: [nonMatch("x"), match("1", 1), nonMatch("y"), match("2", 3), nonMatch("z")]
      });
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);

      expect(() => engine.write("x1y2z")).toThrow("boom");
      expect(chunks.join("")).toBe(expected);
    });
  });
});
