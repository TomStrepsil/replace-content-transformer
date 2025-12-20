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
        expected: [{ content: "OLD", match: true }]
      },
      {
        name: "finds pattern at start of chunk",
        pattern: "OLD",
        chunks: ["OLDtext"],
        expected: [
          { content: "OLD", match: true },
          { content: "text", match: false }
        ]
      },
      {
        name: "finds pattern at end of chunk",
        pattern: "OLD",
        chunks: ["textOLD"],
        expected: [
          { content: "text", match: false },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "finds pattern in middle of chunk",
        pattern: "OLD",
        chunks: ["Hello OLD world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "finds each occurrence when pattern appears multiple times",
        pattern: "OLD",
        chunks: ["Replace OLD and OLD content"],
        expected: [
          { content: "Replace ", match: false },
          { content: "OLD", match: true },
          { content: " and ", match: false },
          { content: "OLD", match: true },
          { content: " content", match: false }
        ]
      },
      {
        name: "finds consecutive occurrences",
        pattern: "OLD",
        chunks: ["OLDOLD"],
        expected: [
          { content: "OLD", match: true },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "handles single character pattern",
        pattern: "X",
        chunks: ["test X test"],
        expected: [
          { content: "test ", match: false },
          { content: "X", match: true },
          { content: " test", match: false }
        ]
      },
      {
        name: "handles long multi-character pattern, with whitespace",
        pattern: "THE COMPLEX PATTERN",
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
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
        if (flush) results.push({ content: flush, match: false });

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
        expected: [{ content: "Hello beautiful world", match: false }]
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
        expected: [{ content: "OLD", match: false }]
      },
      {
        name: "case sensitive - uppercase pattern vs lowercase haystack",
        pattern: "OLD",
        chunks: ["old"],
        expected: [{ content: "old", match: false }]
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
        if (flush) results.push({ content: flush, match: false });

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
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "pattern split at first character",
        pattern: "OLD",
        chunks: ["Hello ", "OLD world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "pattern split after first character",
        pattern: "OLD",
        chunks: ["Hello O", "LD world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "pattern split after second character",
        pattern: "OLD",
        chunks: ["Hello OL", "D world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "pattern split across three chunks",
        pattern: "PATTERN",
        chunks: ["Find PAT", "TER", "N here"],
        expected: [
          { content: "Find ", match: false },
          { content: "PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "pattern split character by character",
        pattern: "OLD",
        chunks: ["Hello ", "O", "L", "D", " world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "incomplete pattern at end of first chunk, complete in second",
        pattern: "OLD",
        chunks: ["text O", "LD more"],
        expected: [
          { content: "text ", match: false },
          { content: "OLD", match: true },
          { content: " more", match: false }
        ]
      },
      {
        name: "false start - partial match fails, then completes in next chunk",
        pattern: "OLD",
        chunks: ["OL OL", "D"],
        expected: [
          { content: "OL ", match: false },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "overlapping pattern across chunks",
        pattern: "OLD",
        chunks: ["OLOL", "D"],
        expected: [
          { content: "OL", match: false },
          { content: "OLD", match: true }
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
        if (flush) results.push({ content: flush, match: false });

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
        expectedYields: [{ content: "text ", match: false }],
        expectedFlush: "O"
      },
      {
        name: "partial match at end - two characters",
        pattern: "OLD",
        chunks: ["text OL"],
        expectedYields: [{ content: "text ", match: false }],
        expectedFlush: "OL"
      },
      {
        name: "partial match at end - longest partial",
        pattern: "ABCDEF",
        chunks: ["text ABCD"],
        expectedYields: [{ content: "text ", match: false }],
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
        expectedYields: [{ content: "OL", match: false }],
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
          { content: "First ", match: false },
          { content: "OLD", match: true },
          { content: " and second ", match: false },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "match at end of first chunk, match at start of second",
        pattern: "OLD",
        chunks: ["First OLD", "OLD second"],
        expected: [
          { content: "First ", match: false },
          { content: "OLD", match: true },
          { content: "OLD", match: true },
          { content: " second", match: false }
        ]
      },
      {
        name: "cross-boundary match followed by same-chunk match",
        pattern: "OLD",
        chunks: ["First O", "LD and OLD"],
        expected: [
          { content: "First ", match: false },
          { content: "OLD", match: true },
          { content: " and ", match: false },
          { content: "OLD", match: true }
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
        if (match.match) {
          break;
        }
      }
      const flushed = strategy.flush(state);

      expect(results).toEqual([
        { content: "First ", match: false },
        { content: "OLD", match: true }
      ]);
      expect(flushed).toBe(" and second OLD");
    });
  });
});
