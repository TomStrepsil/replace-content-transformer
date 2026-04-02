import { describe, it, expect } from "vitest";
import { IndexOfKnuthMorrisPrattSearchStrategy } from "./search-strategy.ts";
import type { MatchResult } from "../../types.ts";

describe("IndexOfKnuthMorrisPratt", () => {
  describe("complete matches in single chunk", () => {
    const testCases = [
      {
        name: "finds pattern when haystack equals pattern",
        pattern: "OLD",
        chunks: ["OLD"],
        expected: [{ isMatch: true, content: "OLD", streamIndices: [0, 3] }]
      },
      {
        name: "finds pattern at start of chunk",
        pattern: "OLD",
        chunks: ["OLDtext"],
        expected: [
          { isMatch: true, content: "OLD", streamIndices: [0, 3] },
          { isMatch: false, content: "text" }
        ]
      },
      {
        name: "finds pattern at end of chunk",
        pattern: "OLD",
        chunks: ["textOLD"],
        expected: [
          { isMatch: false, content: "text" },
          { isMatch: true, content: "OLD", streamIndices: [4, 7] }
        ]
      },
      {
        name: "finds pattern in middle of chunk",
        pattern: "OLD",
        chunks: ["Hello OLD world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "finds each occurrence when pattern appears multiple times",
        pattern: "OLD",
        chunks: ["Replace OLD and OLD content"],
        expected: [
          { isMatch: false, content: "Replace " },
          { isMatch: true, content: "OLD", streamIndices: [8, 11] },
          { isMatch: false, content: " and " },
          { isMatch: true, content: "OLD", streamIndices: [16, 19] },
          { isMatch: false, content: " content" }
        ]
      },
      {
        name: "finds consecutive occurrences",
        pattern: "OLD",
        chunks: ["OLDOLD"],
        expected: [
          { isMatch: true, content: "OLD", streamIndices: [0, 3] },
          { isMatch: true, content: "OLD", streamIndices: [3, 6] }
        ]
      },
      {
        name: "handles single character pattern",
        pattern: "X",
        chunks: ["test X test"],
        expected: [
          { isMatch: false, content: "test " },
          { isMatch: true, content: "X", streamIndices: [5, 6] },
          { isMatch: false, content: " test" }
        ]
      },
      {
        name: "handles long multi-character pattern, with whitespace",
        pattern: "THE COMPLEX PATTERN",
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          { isMatch: true, content: "THE COMPLEX PATTERN", streamIndices: [5, 24] },
          { isMatch: false, content: " here" }
        ]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const strategy = new IndexOfKnuthMorrisPrattSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult[] = [];
        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ isMatch: false, content: flush });

        expect(results).toEqual(expected);
      });
    });
  });

  describe("no match found", () => {
    const testCases = [
      {
        name: "returns content when pattern not found",
        pattern: "OLD",
        chunks: ["Hello beautiful world"],
        expected: [{ isMatch: false, content: "Hello beautiful world" }]
      },
      {
        name: "returns empty for empty haystack",
        pattern: "OLD",
        chunks: [""],
        expected: []
      },
      {
        name: "case sensitive - lowercase pattern vs uppercase haystack",
        pattern: "old",
        chunks: ["OLD"],
        expected: [{ isMatch: false, content: "OLD" }]
      },
      {
        name: "case sensitive - uppercase pattern vs lowercase haystack",
        pattern: "OLD",
        chunks: ["old"],
        expected: [{ isMatch: false, content: "old" }]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const strategy = new IndexOfKnuthMorrisPrattSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult[] = [];

        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ isMatch: false, content: flush });

        expect(results).toEqual(expected);
      });
    });
  });

  describe("cross-chunk boundary matches", () => {
    const testCases = [
      {
        name: "pattern split across two chunks - middle",
        pattern: "OLD",
        chunks: ["Hello O", "LD world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "pattern split at first character",
        pattern: "OLD",
        chunks: ["Hello ", "OLD world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "pattern split after first character",
        pattern: "OLD",
        chunks: ["Hello O", "LD world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "pattern split after second character",
        pattern: "OLD",
        chunks: ["Hello OL", "D world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "pattern split across three chunks",
        pattern: "PATTERN",
        chunks: ["Find PAT", "TER", "N here"],
        expected: [
          { isMatch: false, content: "Find " },
          { isMatch: true, content: "PATTERN", streamIndices: [5, 12] },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "pattern split character by character",
        pattern: "OLD",
        chunks: ["Hello ", "O", "L", "D", " world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "incomplete pattern at end of first chunk, complete in second",
        pattern: "OLD",
        chunks: ["text O", "LD more"],
        expected: [
          { isMatch: false, content: "text " },
          { isMatch: true, content: "OLD", streamIndices: [5, 8] },
          { isMatch: false, content: " more" }
        ]
      },
      {
        name: "false start - partial match fails, then completes in next chunk",
        pattern: "OLD",
        chunks: ["OL OL", "D"],
        expected: [
          { isMatch: false, content: "OL " },
          { isMatch: true, content: "OLD", streamIndices: [3, 6] }
        ]
      },
      {
        name: "overlapping pattern across chunks",
        pattern: "OLD",
        chunks: ["OLOL", "D"],
        expected: [
          { isMatch: false, content: "OL" },
          { isMatch: true, content: "OLD", streamIndices: [2, 5] }
        ]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const strategy = new IndexOfKnuthMorrisPrattSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult[] = [];

        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ isMatch: false, content: flush });

        expect(results).toEqual(expected);
      });
    });
  });

  describe("incomplete matches requiring flush", () => {
    const testCases = [
      {
        name: "partial match at end - one character",
        pattern: "OLD",
        chunks: ["text O"],
        expectedYields: [{ isMatch: false, content: "text " }],
        expectedFlush: "O"
      },
      {
        name: "partial match at end - two characters",
        pattern: "OLD",
        chunks: ["text OL"],
        expectedYields: [{ isMatch: false, content: "text " }],
        expectedFlush: "OL"
      },
      {
        name: "partial match at end - longest partial",
        pattern: "ABCDEF",
        chunks: ["text ABCD"],
        expectedYields: [{ isMatch: false, content: "text " }],
        expectedFlush: "ABCD"
      },
      {
        name: "haystack is prefix of pattern",
        pattern: "LONGPATTERN",
        chunks: ["LONG"],
        expectedYields: [],
        expectedFlush: "LONG"
      },
      {
        name: "overlapping pattern ends incomplete",
        pattern: "OLD",
        chunks: ["OLOL"],
        expectedYields: [{ isMatch: false, content: "OL" }],
        expectedFlush: "OL"
      }
    ];

    testCases.forEach(
      ({ name, pattern, chunks, expectedYields, expectedFlush }) => {
        test(name, () => {
          const strategy = new IndexOfKnuthMorrisPrattSearchStrategy(pattern);
          const state = strategy.createState();
          const results: MatchResult[] = [];

          for (const chunk of chunks) {
            for (const result of strategy.processChunk(chunk, state)) {
              results.push(result);
            }
          }

          expect(results).toEqual(expectedYields);
          expect(strategy.flush(state)).toBe(expectedFlush);
        });
      }
    );
  });

  describe("multiple matches across chunks", () => {
    const testCases = [
      {
        name: "two complete matches in separate chunks",
        pattern: "OLD",
        chunks: ["First OLD", " and second OLD"],
        expected: [
          { isMatch: false, content: "First " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: false, content: " and second " },
          { isMatch: true, content: "OLD", streamIndices: [21, 24] }
        ]
      },
      {
        name: "match at end of first chunk, match at start of second",
        pattern: "OLD",
        chunks: ["First OLD", "OLD second"],
        expected: [
          { isMatch: false, content: "First " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: true, content: "OLD", streamIndices: [9, 12] },
          { isMatch: false, content: " second" }
        ]
      },
      {
        name: "cross-boundary match followed by same-chunk match",
        pattern: "OLD",
        chunks: ["First O", "LD and OLD"],
        expected: [
          { isMatch: false, content: "First " },
          { isMatch: true, content: "OLD", streamIndices: [6, 9] },
          { isMatch: false, content: " and " },
          { isMatch: true, content: "OLD", streamIndices: [14, 17] }
        ]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const strategy = new IndexOfKnuthMorrisPrattSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult[] = [];

        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        expect(results).toEqual(expected);
      });
    });
  });

  describe("aborting matches", () => {
    it("flushes remaining content when cancelling iteration", () => {
      const strategy = new IndexOfKnuthMorrisPrattSearchStrategy("OLD");
      const state = strategy.createState();
      const results: MatchResult[] = [];

      const iterator = strategy.processChunk("First OLD and second OLD", state);
      for (const match of iterator) {
        results.push(match);
        if (match.isMatch) {
          break;
        }
      }
      const flushed = strategy.flush(state);

      expect(results).toEqual([
        { isMatch: false, content: "First " },
        { isMatch: true, content: "OLD", streamIndices: [6, 9] }
      ]);
      expect(flushed).toBe(" and second OLD");
    });
  });
});
