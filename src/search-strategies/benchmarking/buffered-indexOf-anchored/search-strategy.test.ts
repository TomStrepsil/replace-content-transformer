import { describe, it, expect } from "vitest";
import { BufferedIndexOfAnchoredSearchStrategy } from "./search-strategy.ts";
import { MatchResult } from "../../types.ts";

describe("BufferedIndexOfAnchoredSearchStrategy", () => {
  function processChunks(
    strategy: BufferedIndexOfAnchoredSearchStrategy,
    chunks: string[],
    replacement = (match: string) => match.toUpperCase()
  ): { outputs: string[]; flushed: string } {
    const outputs: string[] = [];

    const state = strategy.createState();
    chunks.forEach((chunk) => {
      const generator = strategy.processChunk(chunk, state);
      for (const output of generator) {
        outputs.push(
          output.match ? replacement(output.content) : output.content
        );
      }
    });

    const flushed = strategy.flush(state);
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
          const strategy = new BufferedIndexOfAnchoredSearchStrategy(
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
          const strategy = new BufferedIndexOfAnchoredSearchStrategy(
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
          const strategy = new BufferedIndexOfAnchoredSearchStrategy(
            delimiters
          );
          const { outputs, flushed } = processChunks(strategy, chunks);

          expect(outputs).toEqual(expectedOutputs);
          expect(flushed).toBe(expectedFlush);
        });
      }
    );
  });

  describe("cancellation scenarios", () => {
    it("flushes buffer when cancelling with no matches", () => {
      const strategy = new BufferedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text with ", state);
      outputs.push(generator.next().value!.content);
      generator.return();
      outputs.push(strategy.flush(state));
      expect(outputs).toEqual(["Text with", " "]);
    });

    it("flushes buffer when cancelling with only buffered partial match (mid first anchor)", () => {
      const strategy = new BufferedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text with {", state);
      outputs.push(generator.next().value!.content);
      generator.return();
      outputs.push(strategy.flush(state));
      expect(outputs).toEqual(["Text with ", "{"]);
    });

    it("flushes buffer when cancelling with buffered partial match (post yielding first anchor)", () => {
      const strategy = new BufferedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text with {{ something", state);
      outputs.push(generator.next().value!.content);
      expect(outputs).toEqual(["Text with "]);
      generator.return();
      expect(strategy.flush(state)).toBe("{{ something");
    });

    it("flushes buffer when cancelling after a match, with matches remaining", () => {
      const strategy = new BufferedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const outputs: MatchResult[] = [];

      let generator = strategy.processChunk(
        "Text with {{ something }} and {{ something more }}",
        state
      );
      outputs.push(generator.next().value!);
      outputs.push(generator.next().value!);
      expect(outputs).toEqual([
        { content: "Text with ", match: false },
        { content: "{{ something }}", match: true }
      ]);
      generator.return();
      expect(strategy.flush(state)).toBe(" and {{ something more }}");
    });

    it("flushes buffer correctly when remaining content is smaller than bufferSize", () => {
      const strategy = new BufferedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const generator = strategy.processChunk("X", state);
      generator.next();
      expect(strategy.flush(state)).toBe("X");
    });

    it("flushes buffer correctly when buffer point equals walk position", () => {
      const strategy = new BufferedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      // Exactly bufferSize (1) remaining - yieldUntil would equal position
      const generator = strategy.processChunk("AB", state);
      const result = generator.next();
      expect(result.value?.content).toBe("A");
      expect(result.done).toBe(false);
      generator.return();
      expect(strategy.flush(state)).toBe("B");
    });

    it("preserves correct buffer when cancelled before yielding in 'needle not found' path", () => {
      const strategy = new BufferedIndexOfAnchoredSearchStrategy([
        "START",
        "END"
      ]);
      const state = strategy.createState();

      // Long needle, small remaining content - should NOT yield
      const generator = strategy.processChunk("ABC", state);
      const result = generator.next();
      expect(result.done).toBe(true); // No yield happened
      expect(strategy.flush(state)).toBe("ABC"); // All content buffered
    });

    it("handles cancellation mid-sequence with correct matchStartPosition", () => {
      const strategy = new BufferedIndexOfAnchoredSearchStrategy([
        "{{",
        "}}",
        "!"
      ]);
      const state = strategy.createState();

      // Find first two needles but not the third - should buffer mid-sequence
      const generator = strategy.processChunk("text {{ }} more", state);
      const result1 = generator.next();
      expect(result1.value?.content).toBe("text ");
      expect(result1.value?.match).toBe(false);

      generator.return(); // Cancel mid-sequence (found "{{" and "}}", looking for "!")

      // Should buffer from where "{{" started (matchStartPosition)
      expect(strategy.flush(state)).toBe("{{ }} more");
    });
  });
});
