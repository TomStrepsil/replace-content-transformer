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
        expectedResults: [{ content: "No delimiters here", match: false }],
        expectedFlush: ""
      },
      {
        name: "returns incomplete match when end delimiter missing",
        delimiters: ["{{", "}}"],
        haystack: "Start {{incomplete",
        expectedResults: [{ content: "Start ", match: false }],
        expectedFlush: "{{incomplete"
      },
      {
        name: "returns incomplete match for partial start delimiter at end",
        delimiters: ["{{", "}}"],
        haystack: "text {",
        expectedResults: [{ content: "text ", match: false }],
        expectedFlush: "{"
      },
      {
        name: "handles cross-boundary pattern (opening delimiter split)",
        delimiters: ["{{", "}}"],
        haystack: "Start {{na",
        expectedResults: [{ content: "Start ", match: false }],
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
          { content: "text { single brace } more", match: false }
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
        expectedResults: [{ content: "text ", match: false }],
        expectedFlush: "BEG"
      },
      {
        name: "no partial match when end doesn't match any delimiter prefix",
        delimiters: ["{{", "}}"],
        haystack: "text xyz",
        expectedResults: [{ content: "text xyz", match: false }],
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
          { content: "Hello ", match: false },
          { content: "{{name}}", match: true },
          { content: " world", match: false }
        ],
        expectedFlush: ""
      },
      {
        name: "finds match at start of haystack",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{value}} text" }],
        expectedResults: [
          { content: "{{value}}", match: true },
          { content: " text", match: false }
        ],
        expectedFlush: ""
      },
      {
        name: "finds match at end of haystack",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "text {{value}}" }],
        expectedResults: [
          { content: "text ", match: false },
          { content: "{{value}}", match: true }
        ],
        expectedFlush: ""
      },
      {
        name: "finds first occurrence when multiple matches exist",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{first}} and {{second}}" }],
        expectedResults: [
          { content: "{{first}}", match: true },
          { content: " and ", match: false },
          { content: "{{second}}", match: true }
        ],
        expectedFlush: ""
      },
      {
        name: "handles empty content between delimiters",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "text {{}} more" }],
        expectedResults: [
          { content: "text ", match: false },
          { content: "{{}}", match: true },
          { content: " more", match: false }
        ],
        expectedFlush: ""
      },
      {
        name: "finds complete three-token pattern across three calls",
        delimiters: ['<img src="', '" alt="', '">'],
        calls: [{ haystack: '<img src="/photo.jpg" alt="sunset"> text' }],
        expectedResults: [
          { content: '<img src="/photo.jpg" alt="sunset">', match: true },
          { content: " text", match: false }
        ],
        expectedFlush: ""
      },
      {
        name: "handles single character delimiters",
        delimiters: ["[", "]"],
        calls: [{ haystack: "text [value] more" }],
        expectedResults: [
          { content: "text ", match: false },
          { content: "[value]", match: true },
          { content: " more", match: false }
        ],
        expectedFlush: ""
      },
      {
        name: "handles long content between delimiters",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{this is a very long string with many words}}" }],
        expectedResults: [
          {
            content: "{{this is a very long string with many words}}",
            match: true
          }
        ],
        expectedFlush: ""
      },
      {
        name: "resets state after completing a match",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{first}}" }, { haystack: " and {{second}}" }],
        expectedResults: [
          { content: "{{first}}", match: true },
          { content: " and ", match: false },
          { content: "{{second}}", match: true }
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
        expectedResults: [{ content: "{{name}}", match: true }],
        expectedFlush: ""
      },
      {
        name: "end delimiter split across two chunks: '{{name}' + '}'",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{name}" }, { haystack: "}" }],
        expectedResults: [{ content: "{{name}}", match: true }],
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
          { content: '<img src="/photo.jpg" alt="sunset">', match: true }
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
        expectedResults: [{ content: "{{name}}", match: true }],
        expectedFlush: ""
      },
      {
        name: "complete match in first chunk, then second match starts",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{name}}" }, { haystack: " {{value}}" }],
        expectedResults: [
          { content: "{{name}}", match: true },
          { content: " ", match: false },
          { content: "{{value}}", match: true }
        ],
        expectedFlush: ""
      },
      {
        name: "no match in first chunk, match starts in second",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "text " }, { haystack: "{{name}}" }],
        expectedResults: [
          { content: "text ", match: false },
          { content: "{{name}}", match: true }
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
        expectedResults: [{ content: "BEGIN content END", match: true }],
        expectedFlush: ""
      },
      {
        name: "multiple matches across multiple chunks",
        delimiters: ["{{", "}}"],
        calls: [{ haystack: "{{first}} and {{se" }, { haystack: "cond}} end" }],
        expectedResults: [
          { content: "{{first}}", match: true },
          { content: " and ", match: false },
          { content: "{{second}}", match: true },
          { content: " end", match: false }
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
        if (match.match) {
          break;
        }
      }
      const flushed = strategy.flush(state);

      expect(results).toEqual([
        { content: "First ", match: false },
        { content: "{{OLD}}", match: true }
      ]);
      expect(flushed).toEqual(" and second {{OLD}}");
    });
  });
});
