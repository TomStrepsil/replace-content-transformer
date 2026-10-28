/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect } from "vitest";
import {
  collectCanonicalSearchStrategyResults,
  collectCanonicalSearchStrategyResultsDrivenPastErrors,
  collectSearchStrategyResults,
  collectStoppedSearchStrategyResults,
  heldTextWork,
  longestHeldWhileDriving
} from "../../../test/utilities.js";
import { chunksOf, everySplitOf } from "../../../test/splits.js";
import { BalancedPairSearchStrategy } from "./search-strategy.js";

describe("BalancedPairSearchStrategy", () => {
  describe("simple (non-nested) matches", () => {
    it("yields a simple balanced match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("(content)", state)];
      const flushed = strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "(content)", streamIndices: [0, 9] }
      ]);
      expect(flushed).toBe("");
    });

    it("yields non-match content before and after a simple match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("before (content) after", state)];
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

      const results = [...strategy.processChunk("(a)(b)(c)", state)];
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

      const results = [...strategy.processChunk("no matches here", state)];
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

      const results = [...strategy.processChunk("((inner) outer)", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((inner) outer)", streamIndices: [0, 15] }
      ]);
    });

    it("matches two levels of nesting", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("(((deep)))", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "(((deep)))", streamIndices: [0, 10] }
      ]);
    });

    it("matches content where multiple opens appear before first close", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // ((a) (b)) — each inner pair closes, leaving only the opening at 0 open
      // until the final )
      const results = [...strategy.processChunk("((a) (b))", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((a) (b))", streamIndices: [0, 9] }
      ]);
    });

    it("handles multiple balanced inner pairs before the outer close", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // Each inner pair closes, leaving only the opening at 0 open until the final )
      const results = [...strategy.processChunk("((a) (b) (c))", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "((a) (b) (c))", streamIndices: [0, 13] }
      ]);
    });

    it("yields non-match content surrounding a nested match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("prefix ((inner) outer) suffix", state)];
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

      const results = [...strategy.processChunk("((a) b)(c)", state)];
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
      const results = [...strategy.processChunk("{{{{inner}}}}", state)];
      strategy.flush(state);

      expect(results).toEqual([
        { isMatch: true, content: "{{{{inner}}}}", streamIndices: [0, 13] }
      ]);
    });

    it("starts the next match fresh after yielding a nested one", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // First match: nested
      const results1 = [...strategy.processChunk("((a) b)", state)];
      expect(results1).toEqual([
        { isMatch: true, content: "((a) b)", streamIndices: [0, 7] }
      ]);
      // Second match must accumulate independently with the correct stream indices
      const results2 = [...strategy.processChunk("((c) d)", state)];
      expect(results2).toEqual([
        { isMatch: true, content: "((c) d)", streamIndices: [7, 14] }
      ]);
      strategy.flush(state);
    });
  });

  describe("cross-chunk processing", () => {
    it("matches a simple match split across chunks", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [
        ...strategy.processChunk("(cont", state),
        ...strategy.processChunk("ent)", state)
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
        ...strategy.processChunk("((inner)", state),
        ...strategy.processChunk(" outer)", state)
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
        ...strategy.processChunk("(((deep))", state),
        ...strategy.processChunk(")", state)
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
        ...strategy.processChunk("((inner)", state),
        ...strategy.processChunk(" outer)", state)
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
        ...strategy.processChunk("((a) more", state),
        ...strategy.processChunk(" content)", state)
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
        ...strategy.processChunk("no match", state),
        ...strategy.processChunk("((inner) outer)", state)
      ];
      strategy.flush(state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [8, 23] });
    });

    it("returns buffered content when flushed mid-nested-match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      [...strategy.processChunk("((inner)", state)];
      const flushed = strategy.flush(state);

      expect(flushed).toBe("((inner)");
    });

    it("resets state after flush so the strategy can be reused", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      [...strategy.processChunk("((inner)", state)];
      strategy.flush(state);

      expect(state).toEqual(strategy.createState());

      // After flush, the state is reset: a fresh simple match should yield correctly
      const results = [...strategy.processChunk("(fresh)", state)];
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

      const results = [...strategy.processChunk("prefix (match)", state)];
      strategy.flush(state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [7, 14] });
    });

    it("reports correct indices for a nested match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("text ((a) b) end", state)];
      strategy.flush(state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [5, 12] });
    });

    it("tracks correct indices for a nested match across chunks", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [
        ...strategy.processChunk("prefix ", state),
        ...strategy.processChunk("((inner) outer)", state)
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

      const results = [...strategy.processChunk("(content)", state)];
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
      ["with multi-character delimiters", new BalancedPairSearchStrategy("{{", "}}"), "{{a{{b}}}}c{{d"]
    ] as const)(
      "leaves whatever it has not yielded for flush, wherever iteration stops, %s",
      (_label, strategy, input) => {
        for (const chunks of everySplitOf(input)) {
          const { results, settledResults } = collectSearchStrategyResults(
            strategy,
            chunks
          );
          const total = results.length + settledResults.length;
          for (let limit = 1; limit <= total; limit++) {
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
    const text = (content: string) => ({ isMatch: false, text: content });
    const match = (content: string) => ({ isMatch: true, text: content });

    it.each([
      ["a pair at the limit", "{{", "}}", 8, "a{{1234}}b", [text("a"), match("{{1234}}"), text("b")]],
      ["a pair one over the limit, which passes through as text", "{{", "}}", 8, "a{{12345}}b", [text("a{{12345}}b")]],
      [
        "complete pairs inside an abandoned outer pair",
        "{{", "}}", 10,
        "{{ {{a}} {{b}} xx",
        [text("{{ "), match("{{a}}"), text(" "), match("{{b}}"), text(" xx")]
      ],
      [
        "an inner pair over the limit inside an abandoned outer pair",
        "(", ")", 6,
        "((abcdefg)(b)",
        [text("((abcdefg)"), match("(b)")]
      ],
      ["a pair nested in a kept pair", "(", ")", 6, "x((a))", [text("x"), match("((a))")]],
      ["a run of openings with no closing", "(", ")", 4, "((((((((((", [text("((((((((((")]],
      ["an opening containing the closing, at the limit", "**", "*", 4, "**a**", [match("**a*"), text("*")]],
      ["an opening containing the closing, over the limit", "**", "*", 3, "**a**", [text("**a**")]],
      ["a limit of zero, under which nothing matches", "(", ")", 0, "()", [text("()")]]
    ])(
      "decides %s the same however the input is split",
      (_label, opening, closing, maxBufferLength, input, expected) => {
        for (const chunks of everySplitOf(input)) {
          const { segments, output } = collectCanonicalSearchStrategyResults(
            new BalancedPairSearchStrategy(opening, closing, { maxBufferLength }),
            chunks
          );
          expect(segments, chunks.join("|")).toEqual(expected);
          expect(output).toBe(input);
        }
      }
    );

    it("reports each abandoned opening once, with the span held when it was abandoned", () => {
      const onGuardExceeded = vi.fn();
      collectSearchStrategyResults(
        new BalancedPairSearchStrategy("(", ")", {
          maxBufferLength: 6,
          onGuardExceeded
        }),
        ["((abcdefg)(b)"]
      );

      expect(onGuardExceeded.mock.calls).toEqual([
        [{ streamIndices: [0, 13] }],
        [{ streamIndices: [1, 13] }]
      ]);
    });

    it("keeps the unconsumed input exactly once when the callback throws", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")", {
        maxBufferLength: 4,
        onGuardExceeded: () => {
          throw new Error("callback failed");
        }
      });
      const state = strategy.createState();
      let reported = "";
      const drain = (chunk: string) => {
        for (const result of strategy.processChunk(chunk, state)) {
          reported += result.content;
        }
      };

      drain("x((a)");
      expect(() => drain("bcd")).toThrow("callback failed");
      expect(reported + strategy.flush(state)).toBe("x((a)bcd");
    });

    it("decides as if the callback had not thrown when driven on after it throws, though engines stop driving a strategy that throws", () => {
      const chunks = ["((a)", "bcd", "))(e)"];
      const failure = new Error("callback failed");
      const { segments, errors } = collectCanonicalSearchStrategyResultsDrivenPastErrors(
        new BalancedPairSearchStrategy("(", ")", {
          maxBufferLength: 6,
          onGuardExceeded: vi.fn().mockImplementationOnce(() => {
            throw failure;
          })
        }),
        chunks
      );

      expect(errors).toEqual([failure]);
      expect(segments).toEqual(
        collectCanonicalSearchStrategyResults(
          new BalancedPairSearchStrategy("(", ")", { maxBufferLength: 6 }),
          chunks
        ).segments
      );
    });

    it("leaves whatever it has not yielded for flush, wherever iteration stops after abandoning", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")", { maxBufferLength: 6 });
      const input = "((a)(b)(c)xx(d)";
      for (const chunks of everySplitOf(input)) {
        const { results, settledResults } = collectSearchStrategyResults(strategy, chunks);
        for (let limit = 1; limit <= results.length + settledResults.length; limit++) {
          const { output } = collectStoppedSearchStrategyResults(strategy, chunks, limit);
          expect(output, `${chunks.join("|")} after ${limit}`).toBe(input);
        }
      }
    });

    it("defaults to a limit of 64 Ki code units", () => {
      const input = (length: number) => `{{${"x".repeat(length - 4)}}}`;
      const matchesIn = (haystack: string) =>
        collectSearchStrategyResults(new BalancedPairSearchStrategy("{{", "}}"), [
          haystack
        ]).results.filter(({ isMatch }) => isMatch).length;

      expect(matchesIn(input(65_536))).toBe(1);
      expect(matchesIn(input(65_537))).toBe(0);
    });

    it("lets output through after an unclosed opening, holding no more than the limit and a chunk", () => {
      const chunkLength = 16 * 1024;
      const longestHeld = longestHeldWhileDriving(
        new BalancedPairSearchStrategy("{{", "}}"),
        chunksOf(`{{${"x".repeat(1024 * 1024)}`, chunkLength)
      );

      expect(longestHeld).toBeLessThanOrEqual(65_536 + chunkLength);
    });

    it("holds an unclosed opening with work proportional to the content after it, when unlimited", () => {
      const input = `{{${"x".repeat(64 * 1024)}`;
      const work = heldTextWork(() =>
        longestHeldWhileDriving(
          new BalancedPairSearchStrategy("{{", "}}", { maxBufferLength: Infinity }),
          chunksOf(input, 16)
        )
      );

      expect(work).toBeLessThan(WORK_PER_CODE_UNIT * input.length);
    });

    it.each([
      ["a run of openings", "("],
      ["openings outnumbering closings", "((()"]
    ])("abandons %s with work proportional to the input", (_label, unit) => {
      const input = unit.repeat((64 * 1024) / unit.length);
      const work = heldTextWork(() =>
        longestHeldWhileDriving(
          new BalancedPairSearchStrategy("(", ")", { maxBufferLength: 1024 }),
          chunksOf(input, 16)
        )
      );

      expect(work).toBeLessThan(WORK_PER_CODE_UNIT * input.length);
    });

    it("rejects an invalid maxBufferLength", () => {
      expect(
        () => new BalancedPairSearchStrategy("(", ")", { maxBufferLength: -1 })
      ).toThrow(RangeError);
    });
  });
});
