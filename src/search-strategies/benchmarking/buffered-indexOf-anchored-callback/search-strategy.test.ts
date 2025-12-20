import { describe, it, expect } from "vitest";
import { BufferedIndexOfAnchoredCallbackSearchStrategy } from "./search-strategy.ts";

describe("BufferedIndexOfAnchoredCallbackSearchStrategy", () => {
  // Helper to collect outputs from callback-based processor
  function processChunks(
    strategy: BufferedIndexOfAnchoredCallbackSearchStrategy,
    chunks: string[]
  ): { outputs: string[]; flushed: string } {
    const outputs: string[] = [];

    chunks.forEach((chunk) => {
      strategy.processChunk(chunk, (output) => outputs.push(output));
    });

    const flushed = strategy.flush();
    return { outputs, flushed };
  }

  describe("single call scenarios", () => {
    const singleCallTestCases: Array<{
      name: string;
      delimiters: string[];
      haystack: string;
      expectedOutputs: string[];
      expectedFlush: string;
    }> = [
      {
        name: "returns content when start delimiter not found",
        delimiters: ["{{", "}}"],
        haystack: "No delimiters here",
        expectedOutputs: ["No delimiters her"],
        expectedFlush: "e"
      },
      {
        name: "buffers incomplete match when end delimiter missing",
        delimiters: ["{{", "}}"],
        haystack: "Start {{incomplete",
        expectedOutputs: ["Start "],
        expectedFlush: "{{incomplete"
      },
      {
        name: "buffers partial start delimiter at end",
        delimiters: ["{{", "}}"],
        haystack: "text {",
        expectedOutputs: ["text "],
        expectedFlush: "{"
      },
      {
        name: "handles cross-boundary pattern (opening delimiter split)",
        delimiters: ["{{", "}}"],
        haystack: "Start {{na",
        expectedOutputs: ["Start "],
        expectedFlush: "{{na"
      },
      {
        name: "returns nothing for empty haystack",
        delimiters: ["{{", "}}"],
        haystack: "",
        expectedOutputs: [],
        expectedFlush: ""
      },
      {
        name: "handles delimiter-like content that is not a match",
        delimiters: ["{{", "}}"],
        haystack: "text { single brace } more",
        expectedOutputs: ["text { single brace } mor"],
        expectedFlush: "e"
      },
      {
        name: "partial end delimiter at end",
        delimiters: ["{{", "}}"],
        haystack: "{{value}",
        expectedOutputs: [],
        expectedFlush: "{{value}"
      },
      {
        name: "partial start delimiter with longer pattern",
        delimiters: ["BEGIN", "END"],
        haystack: "text BEG",
        expectedOutputs: ["text"],
        expectedFlush: " BEG"
      },
      {
        name: "no partial match when end doesn't match any delimiter prefix",
        delimiters: ["{{", "}}"],
        haystack: "text xyz",
        expectedOutputs: ["text xy"],
        expectedFlush: "z"
      }
    ];

    singleCallTestCases.forEach(
      ({ name, delimiters, haystack, expectedOutputs, expectedFlush }) => {
        test(name, () => {
          const strategy = new BufferedIndexOfAnchoredCallbackSearchStrategy(
            (match) => match.toUpperCase(),
            delimiters
          );
          const { outputs, flushed } = processChunks(strategy, [haystack]);

          expect(outputs).toEqual(expectedOutputs);
          expect(flushed).toBe(expectedFlush);
        });
      }
    );
  });

  describe("multi-call stateful protocol", () => {
    const multiCallTestCases: Array<{
      name: string;
      delimiters: string[];
      chunks: string[];
      expectedOutputs: string[];
      expectedFlush: string;
    }> = [
      {
        name: "finds complete match with two-token delimiters ({{, }}) in single call",
        delimiters: ["{{", "}}"],
        chunks: ["Hello {{name}} world"],
        expectedOutputs: ["Hello ", "{{NAME}}", " worl"],
        expectedFlush: "d"
      },
      {
        name: "finds match at start of haystack",
        delimiters: ["{{", "}}"],
        chunks: ["{{value}} text"],
        expectedOutputs: ["{{VALUE}}", " tex"],
        expectedFlush: "t"
      },
      {
        name: "finds match at end of haystack",
        delimiters: ["{{", "}}"],
        chunks: ["text {{value}}"],
        expectedOutputs: ["text ", "{{VALUE}}"],
        expectedFlush: ""
      },
      {
        name: "finds multiple matches",
        delimiters: ["{{", "}}"],
        chunks: ["{{first}} and {{second}}"],
        expectedOutputs: ["{{FIRST}}", " and ", "{{SECOND}}"],
        expectedFlush: ""
      },
      {
        name: "handles empty content between delimiters",
        delimiters: ["{{", "}}"],
        chunks: ["text {{}} more"],
        expectedOutputs: ["text ", "{{}}", " mor"],
        expectedFlush: "e"
      },
      {
        name: "finds complete three-token pattern",
        delimiters: ['<img src="', '" alt="', '">'],
        chunks: ['<img src="/photo.jpg" alt="sunset"> text'],
        expectedOutputs: ['<IMG SRC="/PHOTO.JPG" ALT="SUNSET">'],
        expectedFlush: " text"
      },
      {
        name: "handles single character delimiters",
        delimiters: ["[", "]"],
        chunks: ["text [value] more"],
        expectedOutputs: ["text ", "[VALUE]", " more"],
        expectedFlush: ""
      },
      {
        name: "handles long content between delimiters",
        delimiters: ["{{", "}}"],
        chunks: ["{{this is a very long string with many words}}"],
        expectedOutputs: ["{{THIS IS A VERY LONG STRING WITH MANY WORDS}}"],
        expectedFlush: ""
      },
      {
        name: "handles multiple matches across two chunks",
        delimiters: ["{{", "}}"],
        chunks: ["{{first}}", " and {{second}}"],
        expectedOutputs: ["{{FIRST}}", " and ", "{{SECOND}}"],
        expectedFlush: ""
      }
    ];

    multiCallTestCases.forEach(
      ({ name, delimiters, chunks, expectedOutputs, expectedFlush }) => {
        test(name, () => {
          const strategy = new BufferedIndexOfAnchoredCallbackSearchStrategy(
            (match) => match.toUpperCase(),
            delimiters
          );
          const { outputs, flushed } = processChunks(strategy, chunks);

          expect(outputs).toEqual(expectedOutputs);
          expect(flushed).toBe(expectedFlush);
        });
      }
    );
  });

  describe("cross-chunk streaming scenarios", () => {
    const streamingTestCases: Array<{
      name: string;
      delimiters: string[];
      chunks: string[];
      expectedOutputs: string[];
      expectedFlush: string;
    }> = [
      {
        name: "start delimiter split across two chunks: '{' + '{name}}'",
        delimiters: ["{{", "}}"],
        chunks: ["{", "{name}}"],
        expectedOutputs: ["{{NAME}}"],
        expectedFlush: ""
      },
      {
        name: "end delimiter split across two chunks: '{{name}' + '}'",
        delimiters: ["{{", "}}"],
        chunks: ["{{name}", "}"],
        expectedOutputs: ["{{NAME}}"],
        expectedFlush: ""
      },
      {
        name: "middle delimiter split across chunks (three-token)",
        delimiters: ['<img src="', '" alt="', '">'],
        chunks: ['<img src="/photo.jpg', '" alt="sunset">'],
        expectedOutputs: ['<IMG SRC="/PHOTO.JPG" ALT="SUNSET">'],
        expectedFlush: ""
      },
      {
        name: "delimiter split at every character position",
        delimiters: ["{{", "}}"],
        chunks: ["{", "{", "na", "me", "}", "}"],
        expectedOutputs: ["{{NAME}}"],
        expectedFlush: ""
      },
      {
        name: "complete match in first chunk, then second match starts",
        delimiters: ["{{", "}}"],
        chunks: ["{{name}}", " {{value}}"],
        expectedOutputs: ["{{NAME}}", " ", "{{VALUE}}"],
        expectedFlush: ""
      },
      {
        name: "no match in first chunk, match starts in second",
        delimiters: ["{{", "}}"],
        chunks: ["text ", "{{name}}"],
        expectedOutputs: ["text", " ", "{{NAME}}"],
        expectedFlush: ""
      },
      {
        name: "three chunks: partial start, continue, complete",
        delimiters: ["BEGIN", "END"],
        chunks: ["BEG", "IN content E", "ND"],
        expectedOutputs: ["BEGIN CONTENT END"],
        expectedFlush: ""
      },
      {
        name: "multiple matches across multiple chunks",
        delimiters: ["{{", "}}"],
        chunks: ["{{first}} and {{se", "cond}} end"],
        expectedOutputs: ["{{FIRST}}", " and ", "{{SECOND}}", " en"],
        expectedFlush: "d"
      },
      {
        name: "content between chunks without match",
        delimiters: ["{{", "}}"],
        chunks: ["text ", "more text ", "even more"],
        expectedOutputs: ["text", " more text", " even mor"],
        expectedFlush: "e"
      },
      {
        name: "incomplete match at end after multiple chunks",
        delimiters: ["{{", "}}"],
        chunks: ["text ", "{{incomplete"],
        expectedOutputs: ["text", " "],
        expectedFlush: "{{incomplete"
      }
    ];

    streamingTestCases.forEach(
      ({ name, delimiters, chunks, expectedOutputs, expectedFlush }) => {
        test(name, () => {
          const strategy = new BufferedIndexOfAnchoredCallbackSearchStrategy(
            (match) => match.toUpperCase(),
            delimiters
          );
          const { outputs, flushed } = processChunks(strategy, chunks);

          expect(outputs).toEqual(expectedOutputs);
          expect(flushed).toBe(expectedFlush);
        });
      }
    );
  });

  describe("edge cases", () => {
    it("handles four-token delimiters", () => {
      const strategy = new BufferedIndexOfAnchoredCallbackSearchStrategy(
        () => "[REPLACED]",
        ["<a", " href=", '"', '">']
      );
      const { outputs, flushed } = processChunks(strategy, [
        '<a href="url">text</a>'
      ]);

      expect(outputs).toEqual(["[REPLACED]", "text</a"]);
      expect(flushed).toBe(">");
    });

    it("handles nested-looking patterns without actual nesting", () => {
      const strategy = new BufferedIndexOfAnchoredCallbackSearchStrategy(
        (match) => match.toUpperCase(),
        ["{{", "}}"]
      );
      const { outputs, flushed } = processChunks(strategy, [
        "{{outer {{inner}} content}}"
      ]);

      // Should match first complete pair
      expect(outputs).toEqual(["{{OUTER {{INNER}}", " content}"]);
      expect(flushed).toBe("}");
    });

    it("handles replacement function with index parameter", () => {
      const replacements: string[] = [];
      const strategy = new BufferedIndexOfAnchoredCallbackSearchStrategy(
        (match, index) => {
          replacements.push(`Match${index}`);
          return `[${index}]`;
        },
        ["{{", "}}"]
      );

      const { outputs } = processChunks(strategy, ["{{a}} {{b}} {{c}}"]);

      expect(outputs).toEqual(["[0]", " ", "[1]", " ", "[2]"]);
      expect(replacements).toEqual(["Match0", "Match1", "Match2"]);
    });
  });
});
