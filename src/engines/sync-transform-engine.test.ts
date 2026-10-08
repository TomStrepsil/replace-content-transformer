import { describe, it, expect, vi } from "vitest";
import { SyncReplacementTransformEngine } from "./sync-transform-engine.ts";
import type { MatchResult } from "../search-strategies/types.ts";
import { RegexSearchStrategy } from "../search-strategies/regex/search-strategy.ts";
import {
  collectEngineSink,
  mockSearchStrategyFactory,
  flushesText
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
      expect(runEngine(engine, ["hello world"]).join("")).toBe("hello world");
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
      expect(runEngine(engine, ["pre OLD post"]).join("")).toBe("pre NEW post");
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
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          yield {
            isMatch: true,
            content: "M",
            streamIndices: [call * 10, call * 10 + 1] as [number, number]
          };
          call++;
        }),
        flush: vi.fn().mockImplementation(flushesText()),
        matchToString: vi.fn().mockImplementation((m: string) => m)
      };
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
      expect(runEngine(engine, ["X"])).toEqual(["A", "B", "C"]);
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
      expect(runEngine(engine, ["X"])).toEqual(["P", "Q"]);
    });
  });

  describe("multi-chunk state", () => {
    it("preserves strategy state across write() calls — partial match completes in later chunk", () => {
      let call = 0;
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          call++;
          if (call === 1) {
            yield { isMatch: false, content: "text " };
            // strategy internally buffers "OL" — nothing emitted for it
          } else {
            yield {
              isMatch: true,
              content: "OLD",
              streamIndices: [5, 8] as [number, number]
            };
            yield { isMatch: false, content: " end" };
          }
        }),
        flush: vi.fn().mockImplementation(flushesText()),
        matchToString: vi.fn().mockImplementation((m: string) => m)
      };
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
      expect(runEngine(engine, ["HELLO world"])).toEqual(["HI", " world"]);
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
      expect(runEngine(engine, ["A-B"])).toEqual(["X", "-", "X"]);
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
      expect(runEngine(engine, ["M-M"])).toEqual(["0a", "0b", "-", "1a", "1b"]);
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
      expect(runEngine(engine, ["pre X post"])).toEqual(["pre ", " post"]);
    });
  });

  describe("end / flush", () => {
    it("emits strategy tail on end()", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      strategy.flush.mockImplementation(flushesText("TAIL"));
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "R"
      });
      expect(runEngine(engine, ["a"])).toEqual(["a", "TAIL"]);
    });

    it("emits nothing on end() when flush returns empty string", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      strategy.flush.mockImplementation(flushesText(""));
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "R"
      });
      expect(runEngine(engine, ["a"])).toEqual(["a"]);
    });
  });

  describe("settling a deferred match after abort", () => {
    function flushYielding(
      ...results: MatchResult<string>[]
    ): () => Generator<MatchResult<string>, void, undefined> {
      return function* () {
        yield* results;
      };
    }

    it("emits a buffered match verbatim when the first aborted chunk flushes the strategy", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "unused"
      });
      strategy.flush
        .mockImplementationOnce(
          flushYielding(
            { isMatch: false, content: "before " },
            { isMatch: true, content: "MATCH", streamIndices: [7, 12] }
          )
        )
        .mockImplementation(flushesText());

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

      expect(chunks).toEqual(["before ", "MATCH", "passthrough"]);
      expect(replacement).not.toHaveBeenCalled();
    });

    it("emits a match settled by end() verbatim when the signal aborted after the last chunk", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      strategy.flush.mockImplementation(
        flushYielding(
          { isMatch: false, content: "x" },
          { isMatch: true, content: "MATCH", streamIndices: [1, 6] }
        )
      );

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

      expect(chunks).toEqual(["a", "x", "MATCH"]);
      expect(replacement).not.toHaveBeenCalled();
    });

    it("applies the replacement to a match settled by end() when nothing aborted", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      strategy.flush.mockImplementation(
        flushYielding({
          isMatch: true,
          content: "MATCH",
          streamIndices: [1, 6]
        })
      );

      const engine = new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: "R"
      });

      expect(runEngine(engine, ["a"])).toEqual(["a", "R"]);
    });

    it("drops an empty result rather than enqueuing an empty chunk", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      strategy.flush
        .mockImplementationOnce(flushYielding({ isMatch: false, content: "" }))
        .mockImplementation(flushesText());

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

      expect(chunks).toEqual(["passthrough"]);
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
      expect(runEngine(engine, ["X"])).toEqual(["X"]);
      expect(fn).not.toHaveBeenCalled();
    });

    it("flushes buffered tail once on first aborted chunk, then passes subsequent chunks through", () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "a"
      });
      // Real strategy: returns buffer on first flush, then "" once consumed.
      strategy.flush.mockImplementationOnce(flushesText("BUF")).mockImplementation(flushesText());
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
      // BUF flushed on first aborted write, X and Y passed through, end() gets "" from flush
      expect(chunks).toEqual(["BUF", "X", "Y"]);
    });

    it("stops replacement mid-chunk when signal is aborted inside the replacement fn", () => {
      const ac = new AbortController();
      let call = 0;
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          yield {
            isMatch: true,
            content: "A",
            streamIndices: [0, 1] as [number, number]
          };
          yield {
            isMatch: true,
            content: "B",
            streamIndices: [1, 2] as [number, number]
          };
        }),
        flush: vi.fn().mockImplementation(flushesText()),
        matchToString: vi.fn().mockImplementation((m: string) => m)
      };
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
      expect(chunks).toEqual(["R", "B"]);
    });
  });

  describe("zero-length matches", () => {
    function drive(
      pattern: RegExp,
      inputs: string[],
      replacement: string | ((match: RegExpExecArray) => string)
    ): { output: string; seen: string[] } {
      const seen: string[] = [];
      const engine = new SyncReplacementTransformEngine({
        searchStrategy: new RegexSearchStrategy(pattern),
        replacement:
          typeof replacement === "string"
            ? replacement
            : (match: RegExpExecArray) => {
                seen.push(match[0]);
                return replacement(match);
              }
      });
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      for (const input of inputs) engine.write(input);
      engine.end();

      return { output: chunks.join(""), seen };
    }

    it.each([/a?/, /a*/, /(?:)/, /x|/, /(?=a)/, new RegExp("")])(
      "%s terminates, never calls the replacement with an empty match, and echoing each match back reproduces the input exactly",
      (pattern) => {
        const echoMatchBack = (match: RegExpExecArray): string => match[0];
        const { output, seen } = drive(pattern, ["xy", "z"], echoMatchBack);
        expect(seen).not.toContain("");
        expect(output).toBe("xyz");
      }
    );

    it("treats a nullable pattern exactly as its non-nullable equivalent, including where a chunk boundary splits a run", () => {
      const inputs = ["a1", "2b3c"];
      expect(drive(/\d*/, inputs, "#").output).toBe(
        drive(/\d+/, inputs, "#").output
      );
    });

    it("still matches a nullable pattern split across a chunk boundary, buffering instead of passing both characters through", () => {
      expect(drive(/(ab)?/, ["a", "b"], "#").output).toBe("#");
    });
  });
});
