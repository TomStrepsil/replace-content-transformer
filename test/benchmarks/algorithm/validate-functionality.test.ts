import { describe, it, expect } from "vitest";
import * as harnesses from "../../harnesses/index.ts";
import type { BaseHarness } from "../../harnesses/types.ts";
import { mockTransformStreamDefaultControllerFactory } from "../../utilities.ts";

for (const harness of Object.values(harnesses) as BaseHarness[]) {
  const { name, createSearchStrategy, createTransformer, isAsync } = harness;

  const substitutionData = {
    name: "World",
    greeting: "Hello"
  };
  let wrapper = isAsync
    ? async (result: string) => Promise.resolve(result)
    : (result: string) => result;

  let keyedReplacement = (match: string) =>
    wrapper(
      substitutionData[match.slice(2, -2) as keyof typeof substitutionData]
    );
  let indexedReplacement = (_: string, index: number) =>
    wrapper(["Hello", "World"][index]);

  const setupTransformer = (
    tokens: string[],
    replacement: (match: string, index: number) => string | Promise<string>
  ) => {
    const strategy = createSearchStrategy({ tokens, replacement });
    return createTransformer({ strategy, replacement });
  };

  describe(name, () => {
    [
      {
        chunks: ["{{greeting}} {{name}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greeting}} ", "{{name}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greeting}}", " {{name}}!"],
        tokens: ["{{", "}}"],

        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greeti", "ng}} {{name}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greeting}} {{n", "ame}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greet", "ing}} {{n", "ame}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greeting}} ", "{{name}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greeting}}", " {{name}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greeti", "ng}} {{name}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greeting}} {{n", "ame}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greet", "ing}} {{n", "ame}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: keyedReplacement
      },
      {
        chunks: ["{{greet", "ing}} {{n", "ame}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: indexedReplacement
      },
      {
        chunks: ["{", "{x}} {", "{y}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: indexedReplacement
      },
      {
        chunks: ["{{gre{{et", "in}g}} {{{n", "am}e}}!"],
        tokens: ["{{", "}}"],
        expected: "Hello World!",
        replacement: indexedReplacement
      },
      {
        chunks: ["{", " {{x}}"],
        tokens: ["{{", "}}"],
        expected: "{ y",
        replacement: () => "y"
      },
      {
        chunks: ["{", " {{x}} ", "}"],
        tokens: ["{{", "}}"],
        expected: "{ y }",
        replacement: () => "y"
      },
      {
        chunks: ["{", " {{x}", " }}"],
        tokens: ["{{", "}}"],
        expected: "{ y",
        replacement: () => "y"
      }
    ].forEach(({ chunks, tokens, replacement, expected }) => {
      test(`replaces content ("${chunks.join(
        '", "'
      )}") -> ("${expected}")`, async () => {
        const outputs: string[] = [];
        const transformer = setupTransformer(tokens, replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);
        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toEqual(expected);
      });
    });

    describe("benchmark-inspired scenario tests", async () => {
      // Scenario 1: Single chunk, short pattern
      it("Single chunk with multiple anchor sequences", async () => {
        const chunks = ["Hello {{name}}! Welcome to {{place}}."];
        const expected = "Hello World! Welcome to Earth.";

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          return match === "{{name}}" ? "World" : "Earth";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);

        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(2);
      });

      // Scenario 2: Cross-chunk boundary - pattern split in middle
      it("Anchor sequence split across chunk boundary (50/50)", async () => {
        const chunks = ["Hello {{na", "me}}! Welcome."];
        const expected = "Hello World! Welcome.";

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "World";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(1);
      });

      // Scenario 3: Multiple cross-chunk boundaries at different positions
      it("Multiple patterns split at various positions", async () => {
        const chunks = ["{{na", "me}} and {{pla", "ce}} and {{thi", "ng}}"];

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          const content = match.slice(2, -2); // Remove {{ and }}
          return content.toUpperCase();
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);
        const result = [...outputs, flushed].join("");

        expect(result).toBe("NAME and PLACE and THING");
        expect(matchCount).toBe(3);
      });

      // Scenario 4: No matches
      it("No matches found (fast-path)", async () => {
        const chunks = Array.from(
          { length: 10 },
          (_, i) => `chunk ${i + 1} with no pattern matches`
        );

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "REPLACED";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);
        const result = [...outputs, flushed].join("");

        expect(matchCount).toBe(0);
        expect(result).toBe(chunks.join(""));
      });

      // Scenario 5: High match density
      it("High match density (many matches per chunk)", async () => {
        const chunks = Array.from(
          { length: 10 },
          (_, i) => `{{a}}{{b}}{{c}} in chunk ${i + 1}`
        );

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "X";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        transformer.flush(controller);

        expect(matchCount).toBe(30);
      });

      // Scenario 6: Consecutive patterns
      it("Consecutive anchor sequences with no gap", async () => {
        const chunks = ["{{first}}{{second}}{{third}}"];

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          const num = match.slice(2, -2);
          return num.toUpperCase();
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe("FIRSTSECONDTHIRD");
        expect(matchCount).toBe(3);
      });

      // Scenario 7: Long pattern content
      it("Long content between anchors", async () => {
        const longContent = "a".repeat(100);
        const chunks = [`Before {{${longContent}}} after`];

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "REPLACED";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe("Before REPLACED after");
        expect(matchCount).toBe(1);
      });

      // Scenario 8: Large chunks
      it("Large chunks (1KB each)", async () => {
        const baseText = "x".repeat(100) + "{{match}}" + "y".repeat(100);
        const largeChunk = baseText.repeat(5); // ~1KB
        const chunks = Array.from({ length: 5 }, () => largeChunk);

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "FOUND";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        transformer.flush(controller);

        expect(matchCount).toBe(25);
      });

      // Scenario 9: Realistic template scenario
      it("Real-world HTML template with nested structures", async () => {
        const chunks = [
          "<div>{{user.name}}</div>",
          "<span>Email: {{user.em",
          "ail}}</span>",
          "<p>{{user.bio}}</p>"
        ];

        const userData = {
          "user.name": "Alice",
          "user.email": "alice@example.com",
          "user.bio": "Software Engineer"
        };

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          const key = match.slice(2, -2);
          return userData[key as keyof typeof userData] || "";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);
        const result = [...outputs, flushed].join("");

        expect(result).toBe(
          "<div>Alice</div><span>Email: alice@example.com</span><p>Software Engineer</p>"
        );
        expect(matchCount).toBe(3);
      });

      // Scenario 10: Start anchor at end of chunk
      it("Start anchor at chunk boundary", async () => {
        const chunks = ["text before {{", "content}} text after"];

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "REPLACED";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(
          "text before REPLACED text after"
        );
        expect(matchCount).toBe(1);
      });

      // Scenario 11: End anchor at start of chunk
      it("End anchor at chunk boundary", async () => {
        const chunks = ["text before {{content", "}} text after"];

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "REPLACED";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        transformer.flush(controller);

        expect([...outputs].join("")).toBe("text before REPLACED text after");
        expect(matchCount).toBe(1);
      });

      // FALSE START SCENARIOS - Critical for correctness
      it("False starts with single braces before double braces", async () => {
        const chunks = ["{ { { { {{match}} { { { {{another}}"];
        const expected = "{ { { { X { { { X";

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "X";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(2);
      });

      it("False starts across chunk boundaries", async () => {
        const chunks = [
          "prefix { { { { {",
          "{ { { {{valid}}",
          " { { { { { { {",
          "{ {{another}} suffix"
        ];
        const expected = "prefix { { { { MATCH { { { { { { MATCH suffix";

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "MATCH";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(2);
      });

      it("Alternating single and double braces across chunks", async () => {
        const chunks = ["{ x: {", "{ z: {{val}", "} }"];
        const expected = "{ x: 42 }";

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "42";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(1);
      });

      // NESTED BRACES - Critical LaTeX/template scenarios
      it("LaTeX-like nested braces with anchors", async () => {
        const chunks = [
          "\\section{{title}} \\begin{document} {\\bf {{author}}} \\end{document}"
        ];
        const expected =
          "\\section{Introduction} \\begin{document} {\\bf {John Doe}} \\end{document}";

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          if (match === "{{title}}") return "{Introduction}";
          if (match === "{{author}}") return "{John Doe}";
          return match;
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(2);
      });

      it("Many incomplete start anchors across chunks before real match", async () => {
        // Concatenates to: "start { x { y { z {{match}} end"
        // Many single { tokens that look like they might start {{
        // but each chunk only has one {, so {{ never forms until the real match
        // Stresses: handling of potential-but-incomplete anchor starts
        const chunks = ["start { x {", " y { z {", "{match}} end"];
        const expected = "start { x { y { z FOUND end";

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "FOUND";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{", "}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(1);
      });

      // LONGER TOKENS - Test different search algorithm paths
      it("Medium-length tokens (7 chars) split across chunks", async () => {
        const chunks = ["prefix <|STA", "RT|>content<|E", "ND|> suffix"];
        const expected = "prefix VALUE suffix";

        let matchCount = 0;
        const replacement = () => {
          matchCount++;
          return "VALUE";
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(
          ["<|START|>", "<|END|>"],
          replacement
        );
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(1);
      });

      it("Long tokens with repetitive prefix", async () => {
        const chunks = ["text {{{{{MATCH}}}}} more {{{{{VALUE}}}}} end"];
        const expected = "text match more value end";

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          return match.slice(5, -5).toLowerCase();
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{{{{", "}}}}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(2);
      });

      it("Long repetitive tokens split across chunks", async () => {
        const chunks = [
          "start {{{",
          "{{FIRST",
          "}}}}} middle {{{{{SEC",
          "OND}}}}} end"
        ];
        const expected = "start first middle second end";

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          return match.slice(5, -5).toLowerCase();
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(["{{{{{", "}}}}}"], replacement);
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(2);
      });

      // PATHOLOGICAL CASES - Stress testing
      it("Pathological: all-same-character tokens", async () => {
        const chunks = [
          "prefix aaaaaaaaaa{MATCH}aaaaaaaaaa middle aaaaaaaaaa{VALUE}aaaaaaaaaa suffix"
        ];
        const expected = "prefix [MATCH] middle [VALUE] suffix";

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          return `[${match.slice(11, -11)}]`;
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(
          ["aaaaaaaaaa{", "}aaaaaaaaaa"],
          replacement
        );
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(2);
      });

      it("Pathological: all-same-character tokens across chunks", async () => {
        const chunks = ["start aaaaa", "aaaaa{VAL", "UE}aaaaa", "aaaaa end"];
        const expected = "start [VALUE] end";

        let matchCount = 0;
        const replacement = (match: string) => {
          matchCount++;
          return `[${match.slice(11, -11)}]`;
        };

        const outputs: string[] = [];
        const transformer = setupTransformer(
          ["aaaaaaaaaa{", "}aaaaaaaaaa"],
          replacement
        );
        const controller = mockTransformStreamDefaultControllerFactory(outputs);

        for await (const chunk of chunks) {
          await transformer.transform(chunk, controller);
        }
        const flushed = transformer.flush(controller);

        expect([...outputs, flushed].join("")).toBe(expected);
        expect(matchCount).toBe(1);
      });
    });
  });
}
