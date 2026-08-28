import { describe, test, expect } from "vitest";
import { flushToString } from "../../../../test/utilities.js";
import { AnchorSequenceSearchStrategy } from "./search-strategy.js";
import { IndexOfKnuthMorrisPrattSearchStrategy } from "../indexOf-knuth-morris-pratt/index.js";
import { RegexSearchStrategy } from "../../regex/index.js";
import type { MatchResult, SearchStrategy } from "../../types.js";

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
          expect(flushToString(strategy, state)).toBe(expectedFlush);
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
          expect(flushToString(strategy, state)).toBe(expectedFlush);
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
          expect(flushToString(strategy, state)).toBe(expectedFlush);
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
      const flushed = flushToString(strategy, state);

      expect(results).toEqual([
        { isMatch: false, content: "First " },
        { isMatch: true, content: "{{OLD}}", streamIndices: [6, 13] }
      ]);
      expect(flushed).toEqual(" and second {{OLD}}");
    });
  });

  describe("a sub-strategy whose match is not a string", () => {
    // The sequence is generic over TMatch, so a sub-strategy's match may be any
    // shape it likes. `matchToString` is the only contract for rendering one;
    // anything else turns an object match into "[object Object]".
    type TokenMatch = { token: string };

    const tokenAnchor = (
      token: string,
      defer: boolean
    ): SearchStrategy<{ buffer: string }, TokenMatch> => ({
      createState: () => ({ buffer: "" }),
      *processChunk(haystack, state) {
        if (defer) {
          state.buffer += haystack;
          return;
        }
        const scanned = state.buffer + haystack;
        state.buffer = "";
        const index = scanned.indexOf(token);
        if (index === -1) {
          yield { isMatch: false, content: scanned };
          return;
        }
        if (index > 0) yield { isMatch: false, content: scanned.slice(0, index) };
        state.buffer = scanned.slice(index + token.length);
        yield {
          isMatch: true,
          content: { token },
          streamIndices: [index, index + token.length]
        };
      },
      *flush(state) {
        const held = state.buffer;
        state.buffer = "";
        const index = held.indexOf(token);
        if (index === -1) {
          if (held) yield { isMatch: false, content: held };
          return;
        }
        if (index > 0) yield { isMatch: false, content: held.slice(0, index) };
        yield {
          isMatch: true,
          content: { token },
          streamIndices: [index, index + token.length]
        };
        const rest = held.slice(index + token.length);
        if (rest) yield { isMatch: false, content: rest };
      },
      matchToString: (match) => match.token
    });

    const render = (
      strategy: AnchorSequenceSearchStrategy<{ buffer: string }, TokenMatch>,
      results: MatchResult[]
    ) =>
      results
        .map((result) =>
          result.isMatch ? strategy.matchToString(result.content) : result.content
        )
        .join("");

    test("renders a match settled during processChunk through matchToString", () => {
      const strategy = new AnchorSequenceSearchStrategy([
        tokenAnchor("{{", false),
        tokenAnchor("}}", false)
      ]);
      const state = strategy.createState();
      const input = "a {{name}} b";

      const emitted = [
        ...strategy.processChunk(input, state),
        ...strategy.flush(state)
      ];

      expect(render(strategy, emitted)).toBe(input);
      expect(emitted.filter((result) => result.isMatch)).toMatchObject([
        { content: "{{name}}" }
      ]);
    });

    test("renders a match settled during flush through matchToString", () => {
      const strategy = new AnchorSequenceSearchStrategy([
        tokenAnchor("{{", true),
        tokenAnchor("}}", true)
      ]);
      const state = strategy.createState();
      const input = "a {{name}} b";

      const emitted = [
        ...strategy.processChunk(input, state),
        ...strategy.flush(state)
      ];

      expect(render(strategy, emitted)).toBe(input);
      expect(emitted.filter((result) => result.isMatch)).toMatchObject([
        { content: "{{name}}" }
      ]);
    });
  });

  describe("reusing state after flush", () => {
    // `flush` is documented as re-setting the state for re-use, which the other
    // strategies honour: `LoopedIndexOfAnchoredSearchStrategy` resets its needle
    // index, `BalancedPairSearchStrategy` its nesting level. A sequence left
    // mid-way through its anchors has the same obligation — otherwise the next
    // stream opens looking for a closing anchor it never saw opened.
    const sequence = () =>
      new AnchorSequenceSearchStrategy(
        ["{{", "}}"].map(
          (delimiter) => new IndexOfKnuthMorrisPrattSearchStrategy(delimiter)
        )
      );

    test("starts the next stream at the first anchor after ending mid-sequence", () => {
      const strategy = sequence();
      const state = strategy.createState();

      expect([...strategy.processChunk("Start {{incomplete", state)]).toEqual([
        { isMatch: false, content: "Start " }
      ]);
      expect(flushToString(strategy, state)).toBe("{{incomplete");

      expect([...strategy.processChunk("Hello {{name}} world", state)]).toEqual([
        { isMatch: false, content: "Hello " },
        { isMatch: true, content: "{{name}}", streamIndices: [6, 14] },
        { isMatch: false, content: " world" }
      ]);
    });

    test("leaves state equivalent to a freshly created one", () => {
      const strategy = sequence();
      const state = strategy.createState();

      const emitted = [
        ...strategy.processChunk("Start {{incomplete", state),
        ...strategy.flush(state)
      ];

      expect(emitted).toEqual([
        { isMatch: false, content: "Start " },
        { isMatch: false, content: "{{incomplete" }
      ]);
      expect(state).toEqual(strategy.createState());
    });

    test("leaves state equivalent to a freshly created one after a complete match", () => {
      const strategy = sequence();
      const state = strategy.createState();

      const emitted = [
        ...strategy.processChunk("Hello {{name}} world", state),
        ...strategy.flush(state)
      ];

      expect(emitted).toEqual([
        { isMatch: false, content: "Hello " },
        { isMatch: true, content: "{{name}}", streamIndices: [6, 14] },
        { isMatch: false, content: " world" }
      ]);
      expect(state).toEqual(strategy.createState());
    });
  });

  describe("settling a sub-strategy at end of stream", () => {
    // A sub-strategy that defers can be holding a real match when the stream
    // ends, and settling it may leave a tail that belongs to the next anchor.
    // `/abc|a/` buffers "ab" (a viable prefix of the longer branch) rather than
    // matching during processChunk, then settles at flush to the match "a" plus
    // the leftover "b".
    const sequence = () =>
      new AnchorSequenceSearchStrategy([
        new RegexSearchStrategy(/abc|a/),
        new RegexSearchStrategy(/Z/)
      ]);

    test("carries the text after a settled sub-match into the next anchor", () => {
      const strategy = sequence();
      const state = strategy.createState();

      const processed = [...strategy.processChunk("xxab", state)];
      expect(processed).toEqual([{ isMatch: false, content: "xx" }]);

      const flushed = [...strategy.flush(state)];
      expect(flushed).toEqual([{ isMatch: false, content: "ab" }]);
    });

    test("stays lossless when a sub-strategy settles at end of stream", () => {
      const input = "xxab";
      const strategy = sequence();
      const state = strategy.createState();

      const emitted = [
        ...strategy.processChunk(input, state),
        ...strategy.flush(state)
      ].map((result) =>
        result.isMatch ? strategy.matchToString(result.content) : result.content
      );

      expect(emitted.join("")).toBe(input);
    });

    test("drops an empty settled result rather than yielding an empty non-match", () => {
      // No shipped strategy yields empty content, so this needs a stub. The
      // guard is what keeps that contract from leaking out of the sequence.
      const emptyYieldingSubStrategy: SearchStrategy<object, string> = {
        createState: () => ({}),
        *processChunk() {},
        *flush() {
          yield { isMatch: false, content: "" };
        },
        matchToString: (match) => match
      };

      const strategy = new AnchorSequenceSearchStrategy([
        emptyYieldingSubStrategy
      ]);
      const state = strategy.createState();

      expect([...strategy.flush(state)]).toEqual([]);
    });

    test("carries a second settled sub-match on as text for the next anchor", () => {
      // `/a.c|a/` buffers "aa", which settles into two matches. Only the first
      // completes this anchor; the rest is text the next anchor must re-scan.
      const strategy = new AnchorSequenceSearchStrategy([
        new RegexSearchStrategy(/a.c|a/),
        new RegexSearchStrategy(/Z/)
      ]);
      const state = strategy.createState();

      const emitted = [
        ...strategy.processChunk("xxaa", state),
        ...strategy.flush(state)
      ].map((result) =>
        result.isMatch ? strategy.matchToString(result.content) : result.content
      );

      expect(emitted.join("")).toBe("xxaa");
    });

    test("completes the sequence when the tail satisfies the next anchor", () => {
      const strategy = new AnchorSequenceSearchStrategy([
        new RegexSearchStrategy(/abc|a/),
        new RegexSearchStrategy(/b/)
      ]);
      const state = strategy.createState();

      const emitted = [
        ...strategy.processChunk("xxab", state),
        ...strategy.flush(state)
      ];

      expect(emitted).toEqual([
        { isMatch: false, content: "xx" },
        { isMatch: true, content: "ab", streamIndices: [2, 4] }
      ]);
    });
  });
});
