import { describe, test, expect } from "vitest";
import { AnchorSequenceSearchStrategy } from "./search-strategy.ts";
import { IndexOfKnuthMorrisPrattSearchStrategy } from "../indexOf-knuth-morris-pratt/index.ts";
import type { MatchResult } from "../../types.ts";

describe("AnchorSequenceSearchStrategy", () => {
  describe("findMatch - single call scenarios", () => {
    const singleCallTestCases: Array<{
      name: string;
      delimiters: string[];
      haystack: string;
      expectedResults: MatchResult[];
      expectedFlush: string;
    }> = [
      {
        name: "returns null when start delimiter not found",
        delimiters: ["{{", "}}"],
        haystack: "No delimiters here",
        expectedResults: [{ isMatch: false, content: "No delimiters here" }],
        expectedFlush: ""
      },
      {
        name: "returns incomplete match when end delimiter missing",
        delimiters: ["{{", "}}"],
        haystack: "Start {{incomplete",
        expectedResults: [{ isMatch: false, content: "Start " }],
        expectedFlush: "{{incomplete"
      },
      {
        name: "returns incomplete match for partial start delimiter at end",
        delimiters: ["{{", "}}"],
        haystack: "text {",
        expectedResults: [{ isMatch: false, content: "text " }],
        expectedFlush: "{"
      },
      {
        name: "handles cross-boundary pattern (opening delimiter split)",
        delimiters: ["{{", "}}"],
        haystack: "Start {{na",
        expectedResults: [{ isMatch: false, content: "Start " }],
        expectedFlush: "{{na"
      },
      {
        name: "returns null for empty haystack",
        delimiters: ["{{", "}}"],
        haystack: "",
        expectedResults: [],
        expectedFlush: ""
      },
      {
        name: "handles delimiter-like content that is not a match",
        delimiters: ["{{", "}}"],
        haystack: "text { single brace } more",
        expectedResults: [
          { isMatch: false, content: "text { single brace } more" }
        ],
        expectedFlush: ""
      },
      {
        name: "partial end delimiter at end",
        delimiters: ["{{", "}}"],
        haystack: "{{value}",
        expectedResults: [],
        expectedFlush: "{{value}"
      },
      {
        name: "partial start delimiter with longer pattern",
        delimiters: ["BEGIN", "END"],
        haystack: "text BEG",
        expectedResults: [{ isMatch: false, content: "text " }],
        expectedFlush: "BEG"
      },
      {
        name: "no partial match when end doesn't match any delimiter prefix",
        delimiters: ["{{", "}}"],
        haystack: "text xyz",
        expectedResults: [{ isMatch: false, content: "text xyz" }],
        expectedFlush: ""
      }
    ];

    singleCallTestCases.forEach(
      ({ name, delimiters, haystack, expectedResults, expectedFlush }) => {
        test(name, () => {
          const strategy = new AnchorSequenceSearchStrategy(
            delimiters.map(
              (delimiter) =>
                new IndexOfKnuthMorrisPrattSearchStrategy(delimiter)
            )
          );
          const state = strategy.createState();
          const output = [];
          for (const result of strategy.processChunk(haystack, state)) {
            output.push(result);
          }
          expect(strategy.flush(state)).toBe(expectedFlush);
          expect(output).toEqual(expectedResults);
        });
      }
    );
  });

  describe("findMatch - multi-call stateful protocol", () => {
    const multiCallTestCases: Array<{
      name: string;
      delimiters: string[];
      calls: Array<{ haystack: string }>;
      expectedResults: MatchResult[];
      expectedFlush: string;
    }> = [
      {
        name: "finds complete match with two-token delimiters ({{, }}) across two calls",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "Hello {{name}} world" }],
        expectedResults: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: "{{name}}", streamIndices: [6, 14] },
          { isMatch: false, content: " world" }
        ],
        expectedFlush: ""
      },
      {
        name: "finds match at start of haystack",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{value}} text" }],
        expectedResults: [
          { isMatch: true, content: "{{value}}", streamIndices: [0, 9] },
          { isMatch: false, content: " text" }
        ],
        expectedFlush: ""
      },
      {
        name: "finds match at end of haystack",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "text {{value}}" }],
        expectedResults: [
          { isMatch: false, content: "text " },
          { isMatch: true, content: "{{value}}", streamIndices: [5, 14] }
        ],
        expectedFlush: ""
      },
      {
        name: "finds first occurrence when multiple matches exist",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{first}} and {{second}}" }],
        expectedResults: [
          { isMatch: true, content: "{{first}}", streamIndices: [0, 9] },
          { isMatch: false, content: " and " },
          { isMatch: true, content: "{{second}}", streamIndices: [14, 24] }
        ],
        expectedFlush: ""
      },
      {
        name: "handles empty content between delimiters",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "text {{}} more" }],
        expectedResults: [
          { isMatch: false, content: "text " },
          { isMatch: true, content: "{{}}", streamIndices: [5, 9] },
          { isMatch: false, content: " more" }
        ],
        expectedFlush: ""
      },
      {
        name: "finds complete three-token pattern across three calls",
        delimiters: ['<img src="', '" alt="', '">'],
        calls: [{ haystack: '<img src="/photo.jpg" alt="sunset"> text' }],
        expectedResults: [
          { isMatch: true, content: '<img src="/photo.jpg" alt="sunset">', streamIndices: [0, 35] },
          { isMatch: false, content: " text" }
        ],
        expectedFlush: ""
      },
      {
        name: "handles single character delimiters",
        delimiters: ["[", "]"],
        calls: [{ haystack: "text [value] more" }],
        expectedResults: [
          { isMatch: false, content: "text " },
          { isMatch: true, content: "[value]", streamIndices: [5, 12] },
          { isMatch: false, content: " more" }
        ],
        expectedFlush: ""
      },
      {
        name: "handles long content between delimiters",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{this is a very long string with many words}}" }],
        expectedResults: [
          { isMatch: true, content: "{{this is a very long string with many words}}", streamIndices: [0, 46] }
        ],
        expectedFlush: ""
      },
      {
        name: "resets state after completing a match",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{first}}" }, { haystack: " and {{second}}" }],
        expectedResults: [
          { isMatch: true, content: "{{first}}", streamIndices: [0, 9] },
          { isMatch: false, content: " and " },
          { isMatch: true, content: "{{second}}", streamIndices: [14, 24] }
        ],
        expectedFlush: ""
      }
    ];

    multiCallTestCases.forEach(
      ({ name, delimiters, calls, expectedResults, expectedFlush }) => {
        test(name, () => {
          const strategy = new AnchorSequenceSearchStrategy(
            delimiters.map(
              (delimiter) =>
                new IndexOfKnuthMorrisPrattSearchStrategy(delimiter)
            )
          );
          const state = strategy.createState();
          const allResults: MatchResult[] = [];

          calls.forEach(({ haystack }) => {
            for (const result of strategy.processChunk(haystack, state)) {
              allResults.push(result);
            }
          });

          expect(allResults).toEqual(expectedResults);
          expect(strategy.flush(state)).toBe(expectedFlush);
        });
      }
    );
  });

  describe("findMatch - cross-chunk streaming scenarios", () => {
    const streamingTestCases: Array<{
      name: string;
      delimiters: string[];
      calls: Array<{ haystack: string }>;
      expectedResults: MatchResult[];
      expectedFlush: string;
    }> = [
      {
        name: "start delimiter split across two chunks: '{' + '{name}}'",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{" }, { haystack: "{name}}" }],
        expectedResults: [{ isMatch: true, content: "{{name}}", streamIndices: [0, 8] }],
        expectedFlush: ""
      },
      {
        name: "end delimiter split across two chunks: '{{name}' + '}'",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{name}" }, { haystack: "}" }],
        expectedResults: [{ isMatch: true, content: "{{name}}", streamIndices: [0, 8] }],
        expectedFlush: ""
      },
      {
        name: "middle delimiter split across chunks (three-token)",
        delimiters: ['<img src="', '" alt="', '">'],
        calls: [
          { haystack: '<img src="/photo.jpg' },
          { haystack: '" alt="sunset">' }
        ],
        expectedResults: [
          { isMatch: true, content: '<img src="/photo.jpg" alt="sunset">', streamIndices: [0, 35] }
        ],
        expectedFlush: ""
      },
      {
        name: "delimiter split at every character position",
        delimiters: ["{{", "}}"],
        calls: [
          { haystack: "{" },
          { haystack: "{" },
          { haystack: "na" },
          { haystack: "me" },
          { haystack: "}" },
          { haystack: "}" }
        ],
        expectedResults: [{ isMatch: true, content: "{{name}}", streamIndices: [0, 8] }],
        expectedFlush: ""
      },
      {
        name: "complete match in first chunk, then second match starts",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{name}}" }, { haystack: " {{value}}" }],
        expectedResults: [
          { isMatch: true, content: "{{name}}", streamIndices: [0, 8] },
          { isMatch: false, content: " " },
          { isMatch: true, content: "{{value}}", streamIndices: [9, 18] }
        ],
        expectedFlush: ""
      },
      {
        name: "no match in first chunk, match starts in second",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "text " }, { haystack: "{{name}}" }],
        expectedResults: [
          { isMatch: false, content: "text " },
          { isMatch: true, content: "{{name}}", streamIndices: [5, 13] }
        ],
        expectedFlush: ""
      },
      {
        name: "three chunks: partial start, continue, complete",
        delimiters: ["BEGIN", "END"],
        calls: [
          { haystack: "BEG" },
          { haystack: "IN content E" },
          { haystack: "ND" }
        ],
        expectedResults: [{ isMatch: true, content: "BEGIN content END", streamIndices: [0, 17] }],
        expectedFlush: ""
      },
      {
        name: "multiple matches across multiple chunks",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{first}} and {{se" }, { haystack: "cond}} end" }],
        expectedResults: [
          { isMatch: true, content: "{{first}}", streamIndices: [0, 9] },
          { isMatch: false, content: " and " },
          { isMatch: true, content: "{{second}}", streamIndices: [14, 24] },
          { isMatch: false, content: " end" }
        ],
        expectedFlush: ""
      }
    ];

    streamingTestCases.forEach(
      ({ name, delimiters, calls, expectedResults, expectedFlush }) => {
        test(name, () => {
          const strategy = new AnchorSequenceSearchStrategy(
            delimiters.map(
              (delimiter) =>
                new IndexOfKnuthMorrisPrattSearchStrategy(delimiter)
            )
          );
          const state = strategy.createState();
          const allResults: MatchResult[] = [];

          calls.forEach(({ haystack }) => {
            for (const result of strategy.processChunk(haystack, state)) {
              allResults.push(result);
            }
          });

          expect(allResults).toEqual(expectedResults);
          expect(strategy.flush(state)).toBe(expectedFlush);
        });
      }
    );
  });

  describe("aborting matches", () => {
    it("does not find subsequent matches after first match", () => {
      const strategy = new AnchorSequenceSearchStrategy([
        new IndexOfKnuthMorrisPrattSearchStrategy("{{"),
        new IndexOfKnuthMorrisPrattSearchStrategy("}}")
      ]);
      const state = strategy.createState();
      const results: MatchResult[] = [];

      const iterator = strategy.processChunk(
        "First {{OLD}} and second {{OLD}}",
        state
      );
      for (const match of iterator) {
        results.push(match);
        if (match.isMatch) {
          break;
        }
      }
      const flushed = strategy.flush(state);

      expect(results).toEqual([
        { isMatch: false, content: "First " },
        { isMatch: true, content: "{{OLD}}", streamIndices: [6, 13] }
      ]);
      expect(flushed).toEqual(" and second {{OLD}}");
    });
  });
});
