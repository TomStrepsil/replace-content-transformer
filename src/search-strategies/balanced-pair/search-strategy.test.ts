/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect } from "vitest";
import type { BufferGuardOptions } from "../types.js";
import {
  asMatch,
  asText,
  collectCanonicalSearchStrategyResults,
  collectPausedSearchStrategyResults,
  collectSearchStrategyResults,
  collectStoppedSearchStrategyResults,
  heldWhileDriving,
  indexOfWork,
  outputWhenGuardThrows,
  processChunkResults
} from "../../../test/utilities.js";
import {
  chunksOf,
  everySplitOf,
  splitsOnCodePoints
} from "../../../test/splits.js";
import { BalancedPairSearchStrategy } from "./search-strategy.js";

describe("BalancedPairSearchStrategy", () => {
  describe("simple (non-nested) matches", () => {
    it("yields a simple balanced match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = processChunkResults(strategy, "(content)", state);
      const flushed = strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "(content)", streamIndices: [0, 9] }
      ]);
      expect(flushed).toBe("");
    });

    it("yields non-match content before and after a simple match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = processChunkResults(strategy, "before (content) after", state);
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: false, content: "before " },
        { isMatch: true, content: "(content)", streamIndices: [7, 16] },
        { isMatch: false, content: " after" }
      ]);
    });

    it("yields multiple adjacent simple matches", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = processChunkResults(strategy, "(a)(b)(c)", state);
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "(a)", streamIndices: [0, 3] },
        { isMatch: true, content: "(b)", streamIndices: [3, 6] },
        { isMatch: true, content: "(c)", streamIndices: [6, 9] }
      ]);
    });

    it("yields no matches when content has none", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = processChunkResults(strategy, "no matches here", state);
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: false, content: "no matches here" }
      ]);
    });
  });

  describe("nested matches", () => {
    it("matches one level of nesting", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...processChunkResults(strategy, "((inner) outer)", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((inner) outer)", streamIndices: [0, 15] }
      ]);
    });

    it("matches two levels of nesting", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...processChunkResults(strategy, "(((deep)))", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "(((deep)))", streamIndices: [0, 10] }
      ]);
    });

    it("counts a nested pair after another in the same chunk from its own opening", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...processChunkResults(strategy, "((a)b)((c)d)", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((a)b)", streamIndices: [0, 6] },
        { isMatch: true, content: "((c)d)", streamIndices: [6, 12] }
      ]);
    });

    it("matches content where multiple opens appear before first close", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // ((a) (b)) — each inner pair is balanced (net 0 per increment), only the
      // surplus opening at position 0 drives nestingLevel to 1 until the final )
      const results = [...processChunkResults(strategy, "((a) (b))", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((a) (b))", streamIndices: [0, 9] }
      ]);
    });

    it("handles multiple balanced inner pairs before the outer close", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // Each increment " (b)" and " (c)" contributes net 0 (1 open, 1 close),
      // so only the extra ( at position 0 keeps nestingLevel at 1 until the final )
      const results = [...processChunkResults(strategy, "((a) (b) (c))", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((a) (b) (c))", streamIndices: [0, 13] }
      ]);
    });

    it("yields non-match content surrounding a nested match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...processChunkResults(strategy, "prefix ((inner) outer) suffix", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: false, content: "prefix " },
        { isMatch: true, content: "((inner) outer)", streamIndices: [7, 22] },
        { isMatch: false, content: " suffix" }
      ]);
    });

    it("yields a nested match followed by a simple match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...processChunkResults(strategy, "((a) b)(c)", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((a) b)", streamIndices: [0, 7] },
        { isMatch: true, content: "(c)", streamIndices: [7, 10] }
      ]);
    });

    it("works with multi-character opening and closing anchors", () => {
      const strategy = new BalancedPairSearchStrategy("{{", "}}");
      const state = strategy.createState();

      // {{{{inner}}}} — two opening {{ before first closing }}
      const results = processChunkResults(strategy, "{{{{inner}}}}", state);
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "{{{{inner}}}}", streamIndices: [0, 13] }
      ]);
    });

    it("starts the next match afresh after yielding a nested one", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results1 = [...processChunkResults(strategy, "((a) b)", state)];
      expect(results1).toEqual([
        { isMatch: true, content: "((a) b)", streamIndices: [0, 7] }
      ]);
      const results2 = [...processChunkResults(strategy, "((c) d)", state)];
      expect(results2).toEqual([
        { isMatch: true, content: "((c) d)", streamIndices: [7, 14] }
      ]);
      const results3 = [...processChunkResults(strategy, "(e)((f) g)", state)];
      expect(results3).toEqual([
        { isMatch: true, content: "(e)", streamIndices: [14, 17] },
        { isMatch: true, content: "((f) g)", streamIndices: [17, 24] }
      ]);
      strategy.flush(state);
    });
  });

  describe("cross-chunk processing", () => {
    it("matches a simple match split across chunks", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [
        ...processChunkResults(strategy, "(cont", state),
        ...processChunkResults(strategy, "ent)", state)
      ];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "(content)", streamIndices: [0, 9] }
      ]);
    });

    it("matches a nested match when the outer closing is in the next chunk", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [
        ...processChunkResults(strategy, "((inner)", state),
        ...processChunkResults(strategy, " outer)", state)
      ];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((inner) outer)", streamIndices: [0, 15] }
      ]);
    });

    it("matches a deeply nested match split across multiple chunks", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [
        ...processChunkResults(strategy, "(((deep))", state),
        ...processChunkResults(strategy, ")", state)
      ];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "(((deep)))", streamIndices: [0, 10] }
      ]);
    });

    it("yields correct content across chunks without duplicating the buffered portion", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();
      const results = [
        ...processChunkResults(strategy, "((inner)", state),
        ...processChunkResults(strategy, " outer)", state)
      ];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((inner) outer)", streamIndices: [0, 15] }
      ]);
    });

    it("preserves non-match tail content from a chunk that ended mid-nesting", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // Chunk 1 ends with " more" after the inner `)`, while still open at nesting level 1.
      // That tail must survive into chunk 2, not be discarded.
      const results = [
        ...processChunkResults(strategy, "((a) more", state),
        ...processChunkResults(strategy, " content)", state)
      ];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((a) more content)", streamIndices: [0, 18] }
      ]);
    });

    it("tracks stream offset correctly when non-match precedes a nested match in separate chunks", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [
        ...processChunkResults(strategy, "no match", state),
        ...processChunkResults(strategy, "((inner) outer)", state)
      ];
      strategy.flush(state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [8, 23] });
    });

    it("returns buffered content when flushed mid-nested-match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      [...processChunkResults(strategy, "((inner)", state)];
      const flushed = strategy.flush(state);

      expect(flushed).toBe("((inner)");
    });

    it("resets state after flush so the strategy can be reused", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      [...processChunkResults(strategy, "((inner)", state)];
      strategy.flush(state);

      expect(state).toEqual(strategy.createState());

      const results = processChunkResults(strategy, "(fresh)", state);
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "(fresh)", streamIndices: [0, 7] }
      ]);
    });
  });

  describe("stream offset tracking", () => {
    it("reports correct indices for a match following non-match content", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = processChunkResults(strategy, "prefix (match)", state);
      strategy.flush(state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [7, 14] });
    });

    it("reports correct indices for a nested match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...processChunkResults(strategy, "text ((a) b) end", state)];
      strategy.flush(state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [5, 12] });
    });

    it("tracks correct indices for a nested match across chunks", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [
        ...processChunkResults(strategy, "prefix ", state),
        ...processChunkResults(strategy, "((inner) outer)", state)
      ];
      strategy.flush(state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [7, 22] });
    });
  });

  describe("matchToString", () => {
    it("returns the matched content unchanged", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = processChunkResults(strategy, "(content)", state);
      const match = results.find((r) => r.isMatch)!;

      expect(strategy.matchToString(match.content)).toBe("(content)");
    });
  });

  describe("chunk invariance", () => {
    const run = (opening: string, closing: string, chunks: string[]) =>
      collectCanonicalSearchStrategyResults(
        new BalancedPairSearchStrategy(opening, closing),
        chunks
      );

    it.each([
      ["an opening anchor containing the closing anchor", "**", "*", "**a**"],
      ["an opening anchor overlapping its predecessor", "((", "(", "x((y((z"],
      ["a chunk ending inside the outer pair after a nested match", "(", ")", "(((a)b) tail"],
      ["text between nested pairs inside an open outer pair", "(", ")", "((a) x (b) y"],
      ["text after an inner match that closes in a later chunk", "(", ")", "(a(b)c) d(e)"]
    ])(
      "yields the same result however the input is split, with %s",
      (_label, opening, closing, input) => {
        const unsplit = run(opening, closing, [input]);

        for (const chunks of everySplitOf(input)) {
          expect(run(opening, closing, chunks), chunks.join("|")).toEqual(
            unsplit
          );
        }
      }
    );

    it("resumes the search for a closing delimiter after the last one found, when a chunk ends mid-nesting", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      [...processChunkResults(strategy, "((inner)", state)];

      expect(state.buffer).toBe("((inner)");
      expect(state.matchConsumedLength).toBe(8);
    });

    it("matches an opening anchor that contains the closing anchor, split inside the opening", () => {
      const { results } = collectSearchStrategyResults(
        new BalancedPairSearchStrategy("**", "*"),
        ["*", "*a**"]
      );

      expect(results).toEqual([
        { isMatch: true, content: "**a*", streamIndices: [0, 4] }
      ]);
    });
  });

  describe("stopping early", () => {
    it.each([
      ["with nested pairs", new BalancedPairSearchStrategy("(", ")"), "a(b(c)d)e(f)g(h"],
      ["with adjacent pairs", new BalancedPairSearchStrategy("(", ")"), "((a)b)(c)"],
      ["with multi-character delimiters", new BalancedPairSearchStrategy("{{", "}}"), "{{a{{b}}}}c{{d"],
      ["with an over-long outer pair", new BalancedPairSearchStrategy("(", ")", { maxBufferLength: 5 }), "(a(b)(c)d)(e"]
    ] as const)(
      "leaves whatever it has not reported for flush, at whichever match it stops, and carries on from there, %s",
      (_label, strategy, input) => {
        for (const chunks of everySplitOf(input)) {
          const { results, settledResults } = collectSearchStrategyResults(
            strategy,
            chunks
          );
          expect(
            collectPausedSearchStrategyResults(strategy, chunks),
            `${chunks.join("|")} paused at every match`
          ).toEqual([...results, ...settledResults]);
          const matches = [...results, ...settledResults].filter(
            (result) => result.isMatch
          ).length;
          for (let limit = 1; limit <= matches; limit++) {
            const { stopped, output } = collectStoppedSearchStrategyResults(
              strategy,
              chunks,
              limit
            );
            expect(stopped).toBe(true);
            expect(output, `${chunks.join("|")} after ${limit}`).toBe(input);
          }
        }
      }
    );
  });

  describe("buffer guard", () => {
    const WORK_PER_CODE_UNIT = 8;
    const create = (opening: string, closing: string) => (options: BufferGuardOptions) =>
      new BalancedPairSearchStrategy(opening, closing, options);

    it.each([
      ["a pair at the limit", "(", ")", 6, "a(1(2))b", [asText("a"), asMatch("(1(2))"), asText("b")], 0],
      ["a pair one over the limit, which passes through as text", "(", ")", 6, "a(1(23))b", [asText("a(1(23))b")], 1],
      ["a pair starting past the limit inside an unbalanced one, which matches", "(", ")", 5, "(a(b)(c)d)e", [asText("(a(b)"), asMatch("(c)"), asText("d)e")], 1],
      ["the pair after an over-long one holding pairs", "(", ")", 4, "((ab)c)(x)", [asText("((ab)c)"), asMatch("(x)")], 1],
      ["the pair after one over the limit only at its own closing", "(", ")", 6, "(abcdef)(x)", [asText("(abcdef)"), asMatch("(x)")], 1],
      ["a pair between two over-long ones, released once each", "(", ")", 5, "(abcd)(x) (abcdef)", [asText("(abcd)"), asMatch("(x)"), asText(" (abcdef)")], 2],
      ["a run of openings with no closing", "{{", "}}", 6, "{{{{{{{{{", [asText("{{{{{{{{{")], 1],
      ["a run of openings released the limit at a time", "(", ")", 3, "((((((", [asText("((((((")], 2],
      ["a closing found inside the opening's characters", "**", "*", 4, "**a**b*c*", [asMatch("**a*"), asText("*b*c*")], 0],
      ["an opening that contains the closing, past the limit", "ab", "b", 3, "abab abb", [asText("abab "), asMatch("abb")], 1],
      ["delimiters that overlap one another", "ab", "ba", 4, "abba abxba", [asMatch("abba"), asText(" abxba")], 1],
      ["multi-character delimiters past the limit", "<a", "b>", 5, "<a<ab>b> <ab>", [asText("<a<ab>b> "), asMatch("<ab>")], 1],
      ["a partial opening held at the end of the stream", "<!--", "-->", 7, "x<!-", [asText("x<!-")], 0],
      ["a pair opened right after a release, counted afresh", "(", ")", 3, "(()(()", [asText("(()(()")], 2]
    ])(
      "decides %s the same however the input is split",
      (_label, opening, closing, maxBufferLength, input, segments, calls) => {
        for (const chunks of everySplitOf(input)) {
          const onGuardExceeded = vi.fn();
          const strategy = create(opening, closing)({ maxBufferLength, onGuardExceeded });
          expect(
            { ...collectCanonicalSearchStrategyResults(strategy, chunks), calls: onGuardExceeded.mock.calls },
            chunks.join("|")
          ).toEqual({ segments, output: input, calls: Array.from({ length: calls }, () => []) });
        }
      }
    );

    it("never splits a surrogate pair when releasing a pair", () => {
      for (const chunks of splitsOnCodePoints("😀😀x)")) {
        const { results } = collectSearchStrategyResults(
          create("😀", ")")({ maxBufferLength: 3 }),
          chunks
        );
        const splitsAPair = results.some(({ content }) => /[\uD800-\uDBFF]$/.test(content));
        expect(splitsAPair, chunks.join("|")).toBe(false);
      }
    });

    it.each([
      ["while the pair is open", ["x(a(b)", "cd"]],
      ["as the pair completes", ["x(abcd)y"]]
    ])("keeps the unconsumed input exactly once when the callback throws %s", (_label, chunks) => {
      expect(outputWhenGuardThrows(create("(", ")"), chunks, 3)).toEqual({
        threw: true,
        output: chunks.join("")
      });
    });

    it("defaults to a limit of 64 Ki code units", () => {
      const input = (length: number) => `((${"x".repeat(length - 4)}))`;
      const matchesIn = (haystack: string) =>
        collectSearchStrategyResults(new BalancedPairSearchStrategy("(", ")"), [haystack])
          .results.filter(({ isMatch }) => isMatch)
          .map(({ content }) => content.length);

      expect(matchesIn(input(65_536))).toEqual([65_536]);
      expect(matchesIn(input(65_537))).toEqual([]);
    });

    it("lets output through after an unclosed opening followed by 16 MiB, holding no more than the limit", () => {
      const { longestHeld, reportedBeforeLastChunk } = heldWhileDriving(
        new BalancedPairSearchStrategy("{{", "}}"),
        chunksOf(`{{${"x".repeat(16 * 1024 * 1024)}`, 16 * 1024)
      );

      expect(reportedBeforeLastChunk).toBe(true);
      expect(longestHeld).toBeLessThanOrEqual(65_536);
    });

    it.each([
      ["a run of openings", "(".repeat(64 * 1024)],
      ["nesting that keeps deepening", "((()".repeat(16 * 1024)]
    ])("passes %s through with search work proportional to the input", (_label, input) => {
      const work = indexOfWork(() =>
        heldWhileDriving(create("(", ")")({ maxBufferLength: 1024 }), chunksOf(input, 4096))
      );

      expect(work).toBeLessThan(WORK_PER_CODE_UNIT * input.length);
    });

    it.each([-1, Number.NaN])("rejects a maxBufferLength of %j", (maxBufferLength) => {
      expect(() => create("(", ")")({ maxBufferLength })).toThrow(RangeError);
    });

    it("rejects a maxBufferLength shorter than the opening and closing together, under which nothing could match", () => {
      expect(() => create("{{", "}}")({ maxBufferLength: 3 })).toThrow("at least 4");
      expect(() => create("{{", "}}")({ maxBufferLength: 4 })).not.toThrow();
    });
  });
});
