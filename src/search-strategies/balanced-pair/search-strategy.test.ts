/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect } from "vitest";
import { flushToString } from "../../../test/utilities.js";
import { BalancedPairSearchStrategy } from "./search-strategy.js";

describe("BalancedPairSearchStrategy", () => {
  describe("simple (non-nested) matches", () => {
    it("yields a simple balanced match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("(content)", state)];
      const flushed = flushToString(strategy, state);

      expect(results).toEqual([
        { isMatch: true, content: "(content)", streamIndices: [0, 9] }
      ]);
      expect(flushed).toBe("");
    });

    it("yields non-match content before and after a simple match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("before (content) after", state)];
      flushToString(strategy, state);

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
      flushToString(strategy, state);

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
      flushToString(strategy, state);

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
      flushToString(strategy, state);

      expect(results).toEqual([
        { isMatch: true, content: "((inner) outer)", streamIndices: [0, 15] }
      ]);
    });

    it("matches two levels of nesting", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("(((deep)))", state)];
      flushToString(strategy, state);

      expect(results).toEqual([
        { isMatch: true, content: "(((deep)))", streamIndices: [0, 10] }
      ]);
    });

    it("matches content where multiple opens appear before first close", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // ((a) (b)) — each inner pair is balanced (net 0 per increment), only the
      // surplus opening at position 0 drives nestingLevel to 1 until the final )
      const results = [...strategy.processChunk("((a) (b))", state)];
      flushToString(strategy, state);

      expect(results).toEqual([
        { isMatch: true, content: "((a) (b))", streamIndices: [0, 9] }
      ]);
    });

    it("handles multiple balanced inner pairs before the outer close", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // Each increment " (b)" and " (c)" contributes net 0 (1 open, 1 close),
      // so only the extra ( at position 0 keeps nestingLevel at 1 until the final )
      const results = [...strategy.processChunk("((a) (b) (c))", state)];
      flushToString(strategy, state);

      expect(results).toEqual([
        { isMatch: true, content: "((a) (b) (c))", streamIndices: [0, 13] }
      ]);
    });

    it("yields non-match content surrounding a nested match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("prefix ((inner) outer) suffix", state)];
      flushToString(strategy, state);

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
      flushToString(strategy, state);

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
      flushToString(strategy, state);

      expect(results).toEqual([
        { isMatch: true, content: "{{{{inner}}}}", streamIndices: [0, 13] }
      ]);
    });

    it("resets balancedBuffer after yielding a match so subsequent matches start fresh", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      // First match: nested, accumulates into balancedBuffer during processing
      const results1 = [...strategy.processChunk("((a) b)", state)];
      expect(results1).toEqual([
        { isMatch: true, content: "((a) b)", streamIndices: [0, 7] }
      ]);
      // balancedBuffer must be cleared so the next match accumulates independently
      expect(state.balancedBuffer).toBe("");

      // Second match must accumulate independently with the correct stream indices
      const results2 = [...strategy.processChunk("((c) d)", state)];
      expect(results2).toEqual([
        { isMatch: true, content: "((c) d)", streamIndices: [7, 14] }
      ]);
      flushToString(strategy, state);
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
      flushToString(strategy, state);

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
      flushToString(strategy, state);

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
      flushToString(strategy, state);

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
      flushToString(strategy, state);

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
      flushToString(strategy, state);

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
      flushToString(strategy, state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [8, 23] });
    });

    it("returns buffered content when flushed mid-nested-match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      [...strategy.processChunk("((inner)", state)];
      const flushed = flushToString(strategy, state);

      expect(flushed).toBe("((inner)");
    });

    it("resets state after flush so the strategy can be reused", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      [...strategy.processChunk("((inner)", state)];
      flushToString(strategy, state);

      expect(state.nestingLevel).toBe(0);
      expect(state.balancedBuffer).toBe("");

      // After flush, the state is reset: a fresh simple match should yield correctly
      const results = [...strategy.processChunk("(fresh)", state)];
      flushToString(strategy, state);

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
      flushToString(strategy, state);

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({ streamIndices: [7, 14] });
    });

    it("reports correct indices for a nested match", () => {
      const strategy = new BalancedPairSearchStrategy("(", ")");
      const state = strategy.createState();

      const results = [...strategy.processChunk("text ((a) b) end", state)];
      flushToString(strategy, state);

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
      flushToString(strategy, state);

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
});
