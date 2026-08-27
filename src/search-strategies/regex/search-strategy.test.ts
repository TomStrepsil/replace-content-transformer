import { describe, it, expect } from "vitest";
import { RegexSearchStrategy } from "./search-strategy.js";
import type { MatchResult } from "../types.js";
import validateInput from "./input-validation.js";
import PartialMatchRegExp from "regex-partial-match";
import {
  collectCanonicalSearchStrategyResults,
  collectSearchStrategyResults,
  flushToString
} from "../../../test/utilities.js";
import type { CanonicalSegment } from "../../../test/utilities.js";
import {
  characterBySplit,
  everyThreeWaySplit,
  everyTwoWaySplit
} from "../../../test/splits.js";

vi.mock("./input-validation.js");

function getValue(result: MatchResult<RegExpExecArray>): string {
  return result.isMatch ? result.content[0] : result.content;
}

function everySplitOf(haystack: string): string[][] {
  return [
    ...everyTwoWaySplit(haystack),
    ...everyThreeWaySplit(haystack),
    characterBySplit(haystack)
  ];
}

function matchDetailsOf(pattern: RegExp, chunks: string[]) {
  const { results, flushResults } = collectSearchStrategyResults(
    new RegexSearchStrategy(pattern),
    chunks
  );
  return [...results, ...flushResults]
    .filter((result) => result.isMatch)
    .map(({ content, streamIndices }) => ({
      captures: [...content],
      groups: content.groups,
      indices: content.indices && [...content.indices],
      indexGroups: content.indices?.groups,
      streamIndices
    }));
}

function expectSameMatchesAtEverySplit(
  pattern: RegExp,
  haystack: string,
  expectedSegments?: CanonicalSegment[]
): void {
  const unsplit = collectCanonicalSearchStrategyResults(
    new RegexSearchStrategy(pattern),
    [haystack]
  );
  const expected = {
    segments: expectedSegments ?? unsplit.segments,
    details: matchDetailsOf(pattern, [haystack]),
    output: haystack
  };

  for (const chunks of everySplitOf(haystack)) {
    const { segments, output } = collectCanonicalSearchStrategyResults(
      new RegexSearchStrategy(pattern),
      chunks
    );
    const details = matchDetailsOf(pattern, chunks);
    // Compared as one object so a failure reports the offending split.
    expect({ chunks, segments, details, output }).toEqual({
      chunks,
      ...expected
    });
  }
}

function nativeMatchCapturesOf(pattern: RegExp, haystack: string) {
  const global = new RegExp(pattern.source, `${pattern.flags}g`);
  return [...haystack.matchAll(global)]
    .filter((match) => match[0].length > 0)
    .map((match) => [...match]);
}

function streamedMatchCapturesOf(pattern: RegExp, chunks: string[]) {
  return matchDetailsOf(pattern, chunks).map((detail) => detail.captures);
}

function expectNativeCapturesAtEverySplit(
  pattern: RegExp,
  haystack: string
): void {
  const expected = nativeMatchCapturesOf(pattern, haystack);

  for (const chunks of [[haystack], ...everySplitOf(haystack)]) {
    expect({ chunks, captures: streamedMatchCapturesOf(pattern, chunks) }).toEqual(
      { chunks, captures: expected }
    );
  }
}

function describeChunkInvariantCases(
  cases: {
    name: string;
    pattern: RegExp;
    haystack: string;
    expected: CanonicalSegment[];
  }[]
): void {
  cases.forEach(({ name, pattern, haystack, expected }) => {
    describe(name, () => {
      it("matches the non-streaming result when unsplit", () => {
        const { segments, output } = collectCanonicalSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          [haystack]
        );
        expect(segments).toEqual(expected);
        expect(output).toBe(haystack);
      });

      it("matches it at every two-way, three-way and per-character split", () => {
        expectSameMatchesAtEverySplit(pattern, haystack, expected);
      });

      it("reports the captures a non-streaming exec would, at every split", () => {
        expectNativeCapturesAtEverySplit(pattern, haystack);
      });
    });
  });
}

describe("RegexSearchStrategy", () => {
  it("should validate input regex", () => {
    const someRegex = /test-regex/;
    new RegexSearchStrategy(someRegex);
    expect(validateInput).toHaveBeenCalledWith(expect.any(PartialMatchRegExp));
    expect(validateInput).toHaveBeenCalledWith(
      expect.objectContaining({ source: someRegex.source })
    );
  });

  describe("complete matches", () => {
    const testCases = [
      {
        name: "handles no matches in empty haystack",
        pattern: /OLD/,
        chunks: [""],
        expected: []
      },
      {
        name: "handles no matches in non-matching haystack",
        pattern: /OLD/,
        chunks: ["something else"],
        expected: [{ isMatch: false, content: "something else" }]
      },
      {
        name: "finds pattern when haystack equals pattern",
        pattern: /OLD/,
        chunks: ["OLD"],
        expected: [{ isMatch: true, content: expect.arrayContaining(["OLD"]) }]
      },
      {
        name: "finds pattern at start of chunk",
        pattern: /OLD/,
        chunks: ["OLDtext"],
        expected: [
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: "text" }
        ]
      },
      {
        name: "finds pattern at end of chunk",
        pattern: /OLD/,
        chunks: ["textOLD"],
        expected: [
          { isMatch: false, content: "text" },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) }
        ]
      },
      {
        name: "finds pattern in middle of chunk",
        pattern: /OLD/,
        chunks: ["Hello OLD world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "finds each occurrence when pattern appears multiple times",
        pattern: /OLD/,
        chunks: ["Replace OLD and OLD content"],
        expected: [
          { isMatch: false, content: "Replace " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " and " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " content" }
        ]
      },
      {
        name: "finds consecutive occurrences",
        pattern: /OLD/,
        chunks: ["OLDOLD"],
        expected: [
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) }
        ]
      },
      {
        name: "handles single character pattern",
        pattern: /X/,
        chunks: ["test X test"],
        expected: [
          { isMatch: false, content: "test " },
          { isMatch: true, content: expect.arrayContaining(["X"]) },
          { isMatch: false, content: " test" }
        ]
      },
      {
        name: "handles long multi-character pattern, with whitespace",
        pattern: /THE COMPLEX PATTERN/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE COMPLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with wildcards in the middle",
        pattern: /THE .* PATTERN/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE COMPLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with alternation",
        pattern: /(FIRST|SECOND) PATTERN/,
        chunks: ["Find FIRST PATTERN and SECOND PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          { isMatch: true, content: expect.arrayContaining(["FIRST PATTERN"]) },
          { isMatch: false, content: " and " },
          {
            isMatch: true,
            content: expect.arrayContaining(["SECOND PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles multiple patterns with wildcards in the middle, using non-greedy matching",
        pattern: /THE .*? PATTERN/,
        chunks: ["Find THE FIRST PATTERN here and THE SECOND PATTERN there"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE FIRST PATTERN"])
          },
          { isMatch: false, content: " here and " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE SECOND PATTERN"])
          },
          { isMatch: false, content: " there" }
        ]
      },
      {
        name: "handles patterns with character ranges",
        pattern: /[A-Z]+/,
        chunks: ["find PATTERN here"],
        expected: [
          { isMatch: false, content: "find " },
          { isMatch: true, content: expect.arrayContaining(["PATTERN"]) },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with character ranges and quantifiers",
        pattern: /THE [A-Z]{3}PLEX PATTERN/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE COMPLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles wildcards at the start",
        pattern: /.+?PLEX PATTERN/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          {
            isMatch: true,
            content: expect.arrayContaining(["Find THE COMPLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles wildcards at the end",
        pattern: /COMPLEX PATTERN.+/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { isMatch: false, content: "Find THE " },
          {
            isMatch: true,
            content: expect.arrayContaining(["COMPLEX PATTERN here"])
          }
        ]
      },
      {
        name: "handles case-insensitive patterns",
        pattern: /THE COMPLEX PATTERN/i,
        chunks: ["Find The cOmPlEx PATtern here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["The cOmPlEx PATtern"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns that wildcard over newlines",
        pattern: /THE .+ PATTERN/s,
        chunks: ["Find THE COMP\nLEX PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE COMP\nLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with positive lookahead",
        pattern: /THE COMPLEX PATTERN(?= here)/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE COMPLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with positive lookahead (inverse scenario)",
        pattern: /THE COMPLEX PATTERN(?= here)/,
        chunks: ["Find THE COMPLEX PATTERN not here"],
        expected: [
          { isMatch: false, content: "Find THE COMPLEX PATTERN not here" }
        ]
      },
      {
        name: "handles patterns with escaped characters",
        pattern: /THE \.COMPLEX \?PATTERN\*/,
        chunks: ["Find THE .COMPLEX ?PATTERN* here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE .COMPLEX ?PATTERN*"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with Unicode characters and emojis",
        pattern: /(こんにちは|👋)/,
        chunks: ["Say こんにちは to everyone 👋"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こんにちは"]) },
          { isMatch: false, content: " to everyone " },
          { isMatch: true, content: expect.arrayContaining(["👋"]) }
        ]
      },
      {
        name: "handles patterns with unicode character class escapes",
        pattern: /\p{Script=Hiragana}+/u,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こんにちは"]) },
          { isMatch: false, content: " to everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes",
        pattern: /[\p{Script=Hiragana}]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こんにちは"]) },
          { isMatch: false, content: " to everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes (inverse scenario)",
        pattern: /[\p{Script=Hiragana}]+/v,
        chunks: ["Say konnichiwa to everyone"],
        expected: [{ isMatch: false, content: "Say konnichiwa to everyone" }]
      },
      {
        name: "handles patterns with unicodeSet character classes with intersections",
        pattern: /[\p{Script=Hiragana}&&\p{Alphabetic}]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こんにちは"]) },
          { isMatch: false, content: " to everyone" }
        ]
      },
      {
        name: "handles patterns with complement unicodeSet character classes with intersections",
        pattern: /[\P{Script=Hiragana}&&\P{Alphabetic}]+/v,
        chunks: ["Say こんにちは123 to everyone"],
        expected: [
          { isMatch: false, content: "Say" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "こんにちは" },
          { isMatch: true, content: expect.arrayContaining(["123 "]) },
          { isMatch: false, content: "to" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet union character classes",
        pattern: /[\p{Script=Hiragana}\p{Alphabetic}]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { isMatch: true, content: expect.arrayContaining(["Say"]) },
          { isMatch: false, content: " " },
          { isMatch: true, content: expect.arrayContaining(["こんにちは"]) },
          { isMatch: false, content: " " },
          { isMatch: true, content: expect.arrayContaining(["to"]) },
          { isMatch: false, content: " " },
          { isMatch: true, content: expect.arrayContaining(["everyone"]) }
        ]
      },
      {
        name: "handles patterns with unicodeSet union character classes, negated",
        pattern: /[^\p{Script=Hiragana}\p{Alphabetic}]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { isMatch: false, content: "Say" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "こんにちは" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "to" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes with subtraction",
        pattern: /[\p{Script=Hiragana}--[ちは]]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こんに"]) },
          { isMatch: false, content: "ちは to everyone" }
        ]
      },
      {
        name: "handles patterns with capturing groups, returning them with the content (plus the whole match at index 0, to match RegExpExecArray interface)",
        pattern: /(THE)( PATTERN)/,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.objectContaining({
              [0]: "THE PATTERN",
              [1]: "THE",
              [2]: " PATTERN"
            })
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with non-capturing groups",
        pattern: /(THE)(?: PATTERN)/,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.objectContaining({
              [0]: "THE PATTERN",
              [1]: "THE"
            })
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with named capturing groups",
        pattern: /(?<first>THE)(?<second> PATTERN)/,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.objectContaining({
              groups: { first: "THE", second: " PATTERN" }
            })
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with both named and unnamed capturing groups",
        pattern: /(THE)(?<second> PATTERN)/,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.objectContaining({
              [0]: "THE PATTERN",
              [1]: "THE",
              groups: { second: " PATTERN" }
            })
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with astral characters matching as a single character, via the unicode flag",
        pattern: /./u,
        chunks: ["\ud83d\ude04"], // "😄"
        expected: [{ isMatch: true, content: expect.arrayContaining(["😄"]) }]
      },
      {
        name: "handles the d flag, mapping capture-group indices onto the stream",
        pattern: /(?<first>THE) (PATTERN)/d,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.objectContaining({
              indices: expect.objectContaining({
                [0]: [5, 16],
                [1]: [5, 8],
                [2]: [9, 16],
                groups: { first: [5, 8] }
              })
            })
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "literal token",
        pattern: /PLACEHOLDER/,
        chunks: ["a PLACEHOLDER b"],
        expected: [
          { isMatch: false, content: "a " },
          { isMatch: true, content: expect.arrayContaining(["PLACEHOLDER"]) },
          { isMatch: false, content: " b" }
        ]
      },
      {
        name: "delimited token with capture",
        pattern: /\{\{(\w+)\}\}/,
        chunks: ["hi {{name}} and {{other}}!"],
        expected: [
          { isMatch: false, content: "hi " },
          {
            isMatch: true,
            content: expect.arrayContaining(["{{name}}", "name"])
          },
          { isMatch: false, content: " and " },
          {
            isMatch: true,
            content: expect.arrayContaining(["{{other}}", "other"])
          },
          { isMatch: false, content: "!" }
        ]
      },
      {
        name: "character class between anchoring literals",
        pattern: /foo[A-Z]+bar/,
        chunks: ["a fooABCbar b fooZbar c"],
        expected: [
          { isMatch: false, content: "a " },
          { isMatch: true, content: expect.arrayContaining(["fooABCbar"]) },
          { isMatch: false, content: " b " },
          { isMatch: true, content: expect.arrayContaining(["fooZbar"]) },
          { isMatch: false, content: " c" }
        ]
      },
      {
        name: "pattern split across three chunks",
        pattern: /PATTERN/,
        chunks: ["Find PAT", "TER", "N here"],
        expected: [
          { isMatch: false, content: "Find " },
          { isMatch: true, content: expect.arrayContaining(["PATTERN"]) },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "incomplete pattern at end of first chunk, complete in second",
        pattern: /OLD/,
        chunks: ["text O", "LD more"],
        expected: [
          { isMatch: false, content: "text " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " more" }
        ]
      },
      {
        name: "false start - partial match fails, then completes in next chunk",
        pattern: /OLD/,
        chunks: ["OL OL", "D"],
        expected: [
          { isMatch: false, content: "OL " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) }
        ]
      },
      {
        name: "overlapping pattern across chunks",
        pattern: /OLD/,
        chunks: ["OLOL", "D"],
        expected: [
          { isMatch: false, content: "OL" },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) }
        ]
      },
      {
        name: "wild-carded patterns across chunks",
        pattern: /THE .+? PATTERN/,
        chunks: ["Find TH", "E COMPL", "EX ", "PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE COMPLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns that wildcard over newlines, across chunks",
        pattern: /THE .+? PATTERN/s,
        chunks: ["Find THE CO", "MP\nL", "EX PATTERN here"],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE COMP\nLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "rejoins a surrogate pair split across chunks into a single match, via the unicode flag",
        pattern: /(?<foo>.)/u,
        chunks: ["\ud83d", "\ude04"],
        expected: [
          {
            isMatch: true,
            content: expect.objectContaining({
              groups: { foo: "\ud83d\ude04" }
            })
          }
        ]
      }
    ];

    testCases.forEach(
      ({ name, pattern, chunks, expected }) => {
        const skipOnBun =
          typeof Bun !== "undefined" &&
          name.includes("complement unicodeSet character classes");

        describe(name, () => {
          test.skipIf(skipOnBun)("matches", () => {
            const { results, flushResults } = collectSearchStrategyResults(
              new RegexSearchStrategy(pattern),
              chunks
            );
            results.push(...flushResults);

            expect(results).toMatchObject(expected);
          });

          test.skipIf(skipOnBun)(
            "matches the same at every two-way, three-way and per-character split",
            () => {
              expectSameMatchesAtEverySplit(pattern, chunks.join(""));
            }
          );
        });
      }
    );
  });

  describe("no match found", () => {
    const testCases = [
      {
        name: "returns content when pattern not found",
        pattern: /OLD/,
        chunks: ["Hello beautiful world"],
        expected: [{ isMatch: false, content: "Hello beautiful world" }]
      },
      {
        name: "returns empty for empty haystack",
        pattern: /OLD/,
        chunks: [""],
        expected: []
      },
      {
        name: "case sensitive - lowercase pattern vs uppercase haystack",
        pattern: /old/,
        chunks: ["OLD"],
        expected: [{ isMatch: false, content: "OLD" }]
      },
      {
        name: "case sensitive - uppercase pattern vs lowercase haystack",
        pattern: /OLD/,
        chunks: ["old"],
        expected: [{ isMatch: false, content: "old" }]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const { results, flushResults } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          chunks
        );
        results.push(...flushResults);

        expect(results).toMatchObject(expected);
      });
    });
  });

  describe("alternation", () => {
    describeChunkInvariantCases([
      {
        name: "distinct alternation branches",
        pattern: /cat|dog/,
        haystack: "a cat and a dog",
        expected: [
          { isMatch: false, text: "a " },
          { isMatch: true, text: "cat" },
          { isMatch: false, text: " and a " },
          { isMatch: true, text: "dog" }
        ]
      },
      {
        name: "alternation where one branch prefixes another",
        pattern: /<a>|<abc>/,
        haystack: "x<a>y<abc>z",
        expected: [
          { isMatch: false, text: "x" },
          { isMatch: true, text: "<a>" },
          { isMatch: false, text: "y" },
          { isMatch: true, text: "<abc>" },
          { isMatch: false, text: "z" }
        ]
      },
      {
        name: "shortest branch matching inside the longer branch",
        pattern: /abc|b/,
        haystack: "abc",
        expected: [{ isMatch: true, text: "abc" }]
      },
      {
        // The mirror of the case above: having buffered `ab` on the chance that
        // `abc` completes, the strategy must release it and take the `b` match
        // once `X` rules the longer branch out.
        name: "longer branch ruled out, shorter branch still matched",
        pattern: /abc|b/,
        haystack: "abX",
        expected: [
          { isMatch: false, text: "a" },
          { isMatch: true, text: "b" },
          { isMatch: false, text: "X" }
        ]
      },
      {
        name: "template token whose own closing delimiter is a rival branch",
        pattern: /\{\{[^{}]*\}\}|\}/,
        haystack: "a {{b}} c }",
        expected: [
          { isMatch: false, text: "a " },
          { isMatch: true, text: "{{b}}" },
          { isMatch: false, text: " c " },
          { isMatch: true, text: "}" }
        ]
      },
      {
        name: "tag pair whose own closing tag is a rival branch",
        pattern: /<b>[^<]*<\/b>|<\/b>/,
        haystack: "p <b>q</b> r",
        expected: [
          { isMatch: false, text: "p " },
          { isMatch: true, text: "<b>q</b>" },
          { isMatch: false, text: " r" }
        ]
      },
      {
        name: "alternation branch matching inside a longer branch",
        pattern: /foo.?bar|o/,
        haystack: "x fooXbar y o z",
        expected: [
          { isMatch: false, text: "x " },
          { isMatch: true, text: "fooXbar" },
          { isMatch: false, text: " y " },
          { isMatch: true, text: "o" },
          { isMatch: false, text: " z" }
        ]
      },
      {
        name: "quoted string containing the rival alternation branch",
        pattern: /"[^"]*"|\}/,
        haystack: `a "b}c" d } e`,
        expected: [
          { isMatch: false, text: "a " },
          { isMatch: true, text: `"b}c"` },
          { isMatch: false, text: " d " },
          { isMatch: true, text: "}" },
          { isMatch: false, text: " e" }
        ]
      },
      {
        // Both branches start at the same index and the shorter one ends well
        // short of the chunk edge; only a partial match reaching
        // end-of-haystack reveals that `2024-` is still viable.
        name: "higher-priority alternation branch still viable past the accepted match",
        pattern: /\d{4}-\d{2}|\d{4}/,
        haystack: "born 2024-06 ok",
        expected: [
          { isMatch: false, text: "born " },
          { isMatch: true, text: "2024-06" },
          { isMatch: false, text: " ok" }
        ]
      },
      {
        name: "one branch anchored by a literal, the other eagerly quantified",
        pattern: /a\d+z|\d+/,
        haystack: "x a12z y 34 z",
        expected: [
          { isMatch: false, text: "x " },
          { isMatch: true, text: "a12z" },
          { isMatch: false, text: " y " },
          { isMatch: true, text: "34" },
          { isMatch: false, text: " z" }
        ]
      }
    ]);
  });

  describe("quantifiers", () => {
    describeChunkInvariantCases([
      {
        name: "quantified group whose tail is also the pattern's terminator",
        pattern: /(ab)*b/,
        haystack: "abb",
        expected: [{ isMatch: true, text: "abb" }]
      },
      {
        name: "eager quantifier satisfied at the boundary",
        pattern: /[A-Z]+/,
        haystack: "please MATCH this",
        expected: [
          { isMatch: false, text: "please " },
          { isMatch: true, text: "MATCH" },
          { isMatch: false, text: " this" }
        ]
      },
      {
        name: "trailing unbounded quantifier truncated by the boundary",
        pattern: /foo.+/,
        haystack: "foo bar",
        expected: [{ isMatch: true, text: "foo bar" }]
      },
      {
        // `\w?` can consume the very `b` that terminates the pattern, so
        // ending in a literal does not pin down where the match ends.
        name: "optional atom able to consume the pattern's own terminator",
        pattern: /x?\w?b/,
        haystack: "<}bba<x<",
        expected: [
          { isMatch: false, text: "<}" },
          { isMatch: true, text: "bb" },
          { isMatch: false, text: "a<x<" }
        ]
      }
    ]);
  });

  describe("lookahead", () => {
    describeChunkInvariantCases([
      {
        name: "lookahead that only the rest of the stream can rule out",
        pattern: /a(?=bc)/,
        haystack: "abX",
        expected: [{ isMatch: false, text: "abX" }]
      },
      {
        name: "lookahead that fails between two matches",
        pattern: /foo(?=bar)/,
        haystack: "foobarfoobazfoobar",
        expected: [
          { isMatch: true, text: "foo" },
          { isMatch: false, text: "barfoobaz" },
          { isMatch: true, text: "foo" },
          { isMatch: false, text: "bar" }
        ]
      },
      {
        name: "quantifier whose extent is decided by a lookahead",
        pattern: /a+(?=bc)/,
        haystack: "aaabc aab aaabc",
        expected: [
          { isMatch: true, text: "aaa" },
          { isMatch: false, text: "bc aab " },
          { isMatch: true, text: "aaa" },
          { isMatch: false, text: "bc" }
        ]
      },
      {
        name: "capture followed by a lookahead with a near-miss",
        pattern: /(\w+)(?= END)/,
        haystack: "alpha END beta ENDX gamma END",
        expected: [
          { isMatch: true, text: "alpha" },
          { isMatch: false, text: " END " },
          { isMatch: true, text: "beta" },
          { isMatch: false, text: " ENDX " },
          { isMatch: true, text: "gamma" },
          { isMatch: false, text: " END" }
        ]
      },
      {
        name: "lookahead nested inside a lookahead",
        pattern: /a(?=b(?=c))/,
        haystack: "abc abd",
        expected: [
          { isMatch: true, text: "a" },
          { isMatch: false, text: "bc abd" }
        ]
      }
    ]);
  });

  describe("captures under a lookahead the partial regex can satisfy by truncation", () => {
    // The partial regex may take an alternation branch the original would not,
    // because a truncated lookahead is satisfied by end-of-haystack. The branch
    // is zero-width, so the candidate ends short of the haystack and looks
    // settled; confirming only its extent would let that branch's captures
    // through, and a replacement would see capture data a non-streaming `exec`
    // never produces.
    describeChunkInvariantCases([
      {
        name: "only the losing branch captures",
        pattern: /a(?=bc)|(a)/,
        haystack: "ab",
        expected: [
          { isMatch: true, text: "a" },
          { isMatch: false, text: "b" }
        ]
      },
      {
        name: "each branch captures into a different group",
        pattern: /(a)(?=bc)|(a)/,
        haystack: "ab",
        expected: [
          { isMatch: true, text: "a" },
          { isMatch: false, text: "b" }
        ]
      },
      {
        name: "the lookahead is satisfied by input that does arrive",
        pattern: /a(?=bc)|(a)/,
        haystack: "abc",
        expected: [
          { isMatch: true, text: "a" },
          { isMatch: false, text: "bc" }
        ]
      },
      {
        name: "the lookahead is ruled out by input that does arrive",
        pattern: /a(?=bc)|(a)/,
        haystack: "abz",
        expected: [
          { isMatch: true, text: "a" },
          { isMatch: false, text: "bz" }
        ]
      },
      {
        name: "the truncated branch wins mid-stream but loses at the end",
        pattern: /foo(?=bar)|(foo.)/,
        haystack: "xfoob",
        expected: [
          { isMatch: false, text: "x" },
          { isMatch: true, text: "foob" }
        ]
      }
    ]);
  });

  describe("incomplete matches requiring flush", () => {
    const testCases = [
      {
        name: "partial match at end - one character",
        pattern: /OLD/,
        chunks: ["text O"],
        expectedYields: [{ isMatch: false, content: "text " }],
        expectedFlush: "O"
      },
      {
        name: "partial match at end - two characters",
        pattern: /OLD/,
        chunks: ["text OL"],
        expectedYields: [{ isMatch: false, content: "text " }],
        expectedFlush: "OL"
      },
      {
        name: "partial match at end - longest partial",
        pattern: /ABCDEF/,
        chunks: ["text ABCD"],
        expectedYields: [{ isMatch: false, content: "text " }],
        expectedFlush: "ABCD"
      },
      {
        name: "haystack is prefix of pattern",
        pattern: /LONGPATTERN/,
        chunks: ["LONG"],
        expectedYields: [],
        expectedFlush: "LONG"
      },
      {
        name: "overlapping pattern ends incomplete",
        pattern: /OLD/,
        chunks: ["OLOL"],
        expectedYields: [{ isMatch: false, content: "OL" }],
        expectedFlush: "OL"
      }
    ];

    testCases.forEach(
      ({ name, pattern, chunks, expectedYields, expectedFlush }) => {
        test(name, () => {
          const { results, flush } = collectSearchStrategyResults(
            new RegexSearchStrategy(pattern),
            chunks
          );
          expect(results).toEqual(expectedYields);
          expect(flush).toBe(expectedFlush);
        });
      }
    );
  });

  describe("multiple matches across chunks", () => {
    const testCases = [
      {
        name: "two complete matches in separate chunks",
        pattern: /OLD/,
        chunks: ["First OLD", " and second OLD"],
        expected: [
          { isMatch: false, content: "First " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " and second " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) }
        ]
      },
      {
        name: "match at end of first chunk, match at start of second",
        pattern: /OLD/,
        chunks: ["First OLD", "OLD second"],
        expected: [
          { isMatch: false, content: "First " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " second" }
        ]
      },
      {
        name: "cross-boundary match followed by same-chunk match",
        pattern: /OLD/,
        chunks: ["First O", "LD and OLD"],
        expected: [
          { isMatch: false, content: "First " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " and " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) }
        ]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const { results, flushResults } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          chunks
        );

        expect([...results, ...flushResults]).toMatchObject(expected);
      });
    });
  });

  describe("settling at end of stream", () => {
    it("emits a match the stream ended on, rather than flushing it as text", () => {
      const { results, flushResults } = collectSearchStrategyResults(
        new RegexSearchStrategy(/abc|b/),
        ["ab"]
      );
      expect(results).toEqual([]);
      expect(flushResults).toMatchObject([
        { isMatch: false, content: "a" },
        { isMatch: true, content: expect.arrayContaining(["b"]) }
      ]);
    });

    it("maps capture-group and `d`-flag indices of a settled match onto the stream", () => {
      const { flushResults } = collectSearchStrategyResults(
        new RegexSearchStrategy(/\{\{(?<name>\w+)\}\}/d),
        ["prefix ", "{{value}}"]
      );

      const match = flushResults.find((result) => result.isMatch);
      expect(match).toMatchObject({
        isMatch: true,
        streamIndices: [7, 16]
      });
      const content = (match as { content: RegExpExecArray }).content;
      expect(content.groups?.name).toBe("value");
      expect(content.indices?.[0]).toEqual([7, 16]);
      expect(content.indices?.groups?.name).toEqual([9, 14]);
    });

    it("emits content that never became a match as one trailing non-match segment", () => {
      const { results, flushResults } = collectSearchStrategyResults(
        new RegexSearchStrategy(/\{\{\w+\}\}/),
        ["a {{b}} and {{unclo"]
      );
      expect(results).toMatchObject([
        { isMatch: false, content: "a " },
        { isMatch: true, content: expect.arrayContaining(["{{b}}"]) },
        { isMatch: false, content: " and " }
      ]);
      expect(flushResults).toEqual([{ isMatch: false, content: "{{unclo" }]);
    });

    it("settles a match that was deferred across a chunk boundary, onto the right stream offset", () => {
      const pattern = /foo.?bar|o/;
      const chunks = ["x f", "o"];
      expect(pattern.exec(chunks.join(""))?.[0]).toBe("o");

      const { results, flushResults, output } = collectSearchStrategyResults(
        new RegexSearchStrategy(pattern),
        chunks
      );

      expect(results).toEqual([{ isMatch: false, content: "x " }]);
      expect(flushResults).toMatchObject([
        { isMatch: false, content: "f" },
        {
          isMatch: true,
          content: expect.arrayContaining(["o"]),
          streamIndices: [3, 4]
        }
      ]);
      expect(output).toBe(chunks.join(""));
    });

    it("yields nothing when the buffer is empty", () => {
      const strategy = new RegexSearchStrategy(/OLD/);
      const state = strategy.createState();
      expect([...strategy.flush(state)]).toEqual([]);
    });
  });

  describe("the partial-match contract the scan relies on", () => {
    it("reports a zero-length match at end-of-haystack when nothing viable remains, rather than null", () => {
      const partial = new PartialMatchRegExp(/OLD/);
      const match = partial.exec("zzz");
      expect(match).not.toBeNull();
      expect(match![0]).toBe("");
      expect(match!.index).toBe(3);
    });

    it("reports an incomplete match only where it reaches end-of-haystack", () => {
      const partial = new PartialMatchRegExp(/OLD/);
      const truncated = partial.exec("xxOL")!;
      expect(truncated[0]).toBe("OL");
      expect(truncated.index + truncated[0].length).toBe(4);

      const settled = partial.exec("xxOLDyy")!;
      expect(settled[0]).toBe("OLD");
      expect(settled.index + settled[0].length).toBeLessThan(7);
    });

    it("passes the remainder through if the partial regex ever reports no match at all", () => {
      const strategy = new RegexSearchStrategy(/OLD/);
      const state = strategy.createState();
      vi.spyOn(PartialMatchRegExp.prototype, "exec").mockReturnValue(null);
      try {
        const results = [...strategy.processChunk("anything", state)];
        expect(results).toEqual([{ isMatch: false, content: "anything" }]);
        expect(state.buffer).toBe("");
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe("cancellation scenarios", () => {
    it("has no remainder when cancelling with no matches", () => {
      const strategy = new RegexSearchStrategy(/{{.+?}}/s);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text with ", state);
      outputs.push(getValue(generator.next().value!));
      expect(generator.return().value).toBeUndefined();
      expect(flushToString(strategy, state)).toBe("");
      expect(outputs).toMatchObject(["Text with "]);
    });

    it("has no remainder when cancelling with only buffered partial match (mid first anchor)", () => {
      const strategy = new RegexSearchStrategy(/{{.+?}}/s);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text with {", state);
      outputs.push(getValue(generator.next().value!));
      const remainder = generator.return().value;
      outputs.push(flushToString(strategy, state));
      expect(remainder).toBeUndefined();
      expect(outputs).toMatchObject(["Text with ", "{"]);
    });

    it("has appropriate flush when cancelling after a match, with matches remaining", () => {
      const strategy = new RegexSearchStrategy(/{{.+?}}/s);
      const state = strategy.createState();

      const outputs: MatchResult<RegExpExecArray>[] = [];

      for (const value of strategy.processChunk(
        "Text with {{ something }} and {{ something more }}",
        state
      )) {
        outputs.push(value);
        if (outputs.length === 2) break;
      }
      expect(outputs).toMatchObject([
        { isMatch: false, content: "Text with " },
        { isMatch: true, content: expect.arrayContaining(["{{ something }}"]) }
      ]);
      expect(flushToString(strategy, state)).toBe(" and {{ something more }}");
    });
  });

  describe("stream offset tracking", () => {
    it("should track correct indices for single chunk match", () => {
      const strategy = new RegexSearchStrategy(/OLD/);
      const state = strategy.createState();

      const results = [...strategy.processChunk("before OLD after", state)];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 10]
      });
    });

    it("should track correct indices across chunk boundaries", () => {
      const strategy = new RegexSearchStrategy(/OLD/);
      const state = strategy.createState();

      const results1 = [...strategy.processChunk("prefix OL", state)];
      const results2 = [...strategy.processChunk("D suffix", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 10]
      });
    });

    it("should track multiple matches with correct indices", () => {
      const strategy = new RegexSearchStrategy(/OLD/);
      const state = strategy.createState();

      const results = [...strategy.processChunk("a OLD b OLD c", state)];

      const matches = results.filter((r) => r.isMatch);
      expect(matches).toHaveLength(2);
      expect(matches[0]).toMatchObject({
        streamIndices: [2, 5]
      });
      expect(matches[1]).toMatchObject({
        streamIndices: [8, 11]
      });
    });

    it("should track indices across multiple chunks with no matches initially", () => {
      const strategy = new RegexSearchStrategy(/OLD/);
      const state = strategy.createState();

      const results1 = [...strategy.processChunk("chunk1 no matches ", state)];
      const results2 = [...strategy.processChunk("chunk2 OLD end", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [25, 28]
      });
    });

    it("should reset offset on createState", () => {
      const strategy = new RegexSearchStrategy(/OLD/);

      const state1 = strategy.createState();
      const results1 = [
        ...strategy.processChunk("OLD", state1),
        ...strategy.flush(state1)
      ];
      const match1 = results1.find((r) => r.isMatch);
      expect(match1?.streamIndices[0]).toBe(0);

      const state2 = strategy.createState();
      const results2 = [
        ...strategy.processChunk("OLD", state2),
        ...strategy.flush(state2)
      ];
      const match2 = results2.find((r) => r.isMatch);
      expect(match2?.streamIndices[0]).toBe(0);
    });

    it("should track indices with capture groups", () => {
      const strategy = new RegexSearchStrategy(/{{(\w+)}}/);
      const state = strategy.createState();

      const results = [
        ...strategy.processChunk("prefix {{name}} suffix", state)
      ];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 15]
      });
    });

    it("should handle indices correctly with buffered partial matches", () => {
      const strategy = new RegexSearchStrategy(/{{.+?}}/);
      const state = strategy.createState();

      const results1 = [...strategy.processChunk("text {", state)];
      const results2 = [...strategy.processChunk("{done}} after", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [5, 13]
      });
    });

    it("should track indices for match at stream start", () => {
      const strategy = new RegexSearchStrategy(/OLD/);
      const state = strategy.createState();

      const results = [...strategy.processChunk("OLD after", state)];

      expect(results[0]).toMatchObject({
        isMatch: true,
        streamIndices: [0, 3]
      });
    });
  });

  describe("RegExpExecArray.indices with d flag", () => {
    it("should produce indices on matches", () => {
      const strategy = new RegexSearchStrategy(/OLD/d);
      const state = strategy.createState();

      const results = [...strategy.processChunk("prefix OLD suffix", state)];
      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        isMatch: true,
        streamIndices: [7, 10]
      });
      expect(match!.content.indices![0]).toEqual([7, 10]);
    });

    it("should produce indices for capture groups", () => {
      const strategy = new RegexSearchStrategy(/{{(\w+)}}/d);
      const state = strategy.createState();

      const results = [
        ...strategy.processChunk("prefix {{name}} suffix", state)
      ];
      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 15]
      });
      const indices = match!.content.indices!;
      expect(indices[0]).toEqual([7, 15]);
      expect(indices[1]).toEqual([9, 13]);
    });

    it("should produce named group indices", () => {
      const strategy = new RegexSearchStrategy(/{{(?<name>\w+)}}/d);
      const state = strategy.createState();

      const results = [
        ...strategy.processChunk("prefix {{foo}} suffix", state)
      ];
      const match = results.find((r) => r.isMatch);
      const indices = match!.content.indices!;
      expect(indices[0]).toEqual([7, 14]);
      expect(indices.groups!.name).toEqual([9, 12]);
    });

    it("should adjust named group indices exactly once with a non-zero offset", () => {
      const strategy = new RegexSearchStrategy(/{{(?<name>\w+)}}/d);
      const state = strategy.createState();

      const results1 = [...strategy.processChunk("prefix ", state)];
      const results2 = [...strategy.processChunk("{{value}} tail", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 16]
      });
      const indices = match!.content.indices!;
      expect(indices[0]).toEqual([7, 16]);
      expect(indices[1]).toEqual([9, 14]);
      expect(indices.groups!.name).toEqual([9, 14]);
    });

    it("should adjust indices across chunk boundaries", () => {
      const strategy = new RegexSearchStrategy(/OLD/d);
      const state = strategy.createState();

      const results1 = [...strategy.processChunk("chunk1 no match ", state)];
      const results2 = [...strategy.processChunk("chunk2 OLD end", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [23, 26]
      });
      expect(match!.content.indices![0]).toEqual([23, 26]);
    });

    it("should adjust indices for multiple matches", () => {
      const strategy = new RegexSearchStrategy(/OLD/d);
      const state = strategy.createState();

      const results = [...strategy.processChunk("a OLD b OLD c", state)];

      const matches = results.filter((r) => r.isMatch);
      expect(matches).toHaveLength(2);
      expect(matches[0]!.content.indices![0]).toEqual([2, 5]);
      expect(matches[1]!.content.indices![0]).toEqual([8, 11]);
    });

    it("should adjust indices across buffered partial matches", () => {
      const strategy = new RegexSearchStrategy(/OLD/d);
      const state = strategy.createState();

      const results1 = [...strategy.processChunk("text OL", state)];
      const results2 = [...strategy.processChunk("D end", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [5, 8]
      });
      expect(match!.content.indices![0]).toEqual([5, 8]);
    });

    it("should handle optional unmatched capture group (undefined index entry)", () => {
      const strategy = new RegexSearchStrategy(/a(b)?c/d);
      const state = strategy.createState();

      const results = [...strategy.processChunk("prefix ac suffix", state)];
      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 9]
      });
      const indices = match!.content.indices!;
      expect(indices[0]).toEqual([7, 9]);
      expect(indices[1]).toBeUndefined();
    });

    it("should handle optional matched capture group", () => {
      const strategy = new RegexSearchStrategy(/a(b)?c/d);
      const state = strategy.createState();

      const results = [...strategy.processChunk("prefix abc suffix", state)];
      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 10]
      });
      const indices = match!.content.indices!;
      expect(indices[0]).toEqual([7, 10]);
      expect(indices[1]).toEqual([8, 9]);
    });

    it("should handle named optional unmatched group (undefined in indices.groups)", () => {
      const strategy = new RegexSearchStrategy(/a(?<mid>b)?c/d);
      const state = strategy.createState();

      const results = [...strategy.processChunk("prefix ac suffix", state)];
      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 9]
      });
      const indices = match!.content.indices!;
      expect(indices[0]).toEqual([7, 9]);
      expect(indices[1]).toBeUndefined();
      expect(indices.groups!.mid).toBeUndefined();
    });

    it("should handle named optional matched group", () => {
      const strategy = new RegexSearchStrategy(/a(?<mid>b)?c/d);
      const state = strategy.createState();

      const results = [...strategy.processChunk("prefix abc suffix", state)];
      const match = results.find((r) => r.isMatch);
      const indices = match!.content.indices!;
      expect(indices[0]).toEqual([7, 10]);
      expect(indices[1]).toEqual([8, 9]);
      expect(indices.groups!.mid).toEqual([8, 9]);
    });

    it("should handle mixed matched and unmatched optional groups", () => {
      const strategy = new RegexSearchStrategy(/(?<a>x)?y(?<b>z)?/d);
      const state = strategy.createState();

      // Only "y" matches — both optional groups unmatched
      const results1 = [...strategy.processChunk("prefix y suffix", state)];
      const match1 = results1.find((r) => r.isMatch);
      const indices1 = match1!.content.indices!;
      expect(indices1[0]).toEqual([7, 8]);
      expect(indices1[1]).toBeUndefined();
      expect(indices1[2]).toBeUndefined();
      expect(indices1.groups!.a).toBeUndefined();
      expect(indices1.groups!.b).toBeUndefined();
    });

    it("should handle optional groups with offset from prior chunks", () => {
      const strategy = new RegexSearchStrategy(/a(?<opt>b)?c/d);
      const state = strategy.createState();

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- just need to dummy process a chunk to advance the stream index
      [...strategy.processChunk("first chunk no match ", state)];
      const results2 = [...strategy.processChunk("ac end", state)];
      const match = results2.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [21, 23]
      });
      const indices = match!.content.indices!;
      expect(indices[0]).toEqual([21, 23]);
      expect(indices[1]).toBeUndefined();
      expect(indices.groups!.opt).toBeUndefined();
    });

    it("should handle alternation where one branch has more groups", () => {
      const strategy = new RegexSearchStrategy(/(?<word>\w+)|(?<num>\d+)/d);
      const state = strategy.createState();

      const results = [...strategy.processChunk("prefix hello suffix", state)];
      const match = results.find((r) => r.isMatch);
      const indices = match!.content.indices!;
      // "word" group matched, "num" group undefined
      expect(indices.groups!.word).toEqual(indices[1]);
      expect(indices.groups!.num).toBeUndefined();
    });

    it("should produce correct streamIndices when state is reused after flush", () => {
      const strategy = new RegexSearchStrategy(/hello/d);
      const state = strategy.createState();

      // Stream 1: match at position 7
      const results1 = [...strategy.processChunk("prefix hello suffix", state)];
      flushToString(strategy, state);
      const match1 = results1.find((r) => r.isMatch);
      expect(match1).toMatchObject({ streamIndices: [7, 12] });

      // Stream 2: reuse state after flush — indices should start from 0 again
      const results2 = [...strategy.processChunk("prefix hello suffix", state)];
      flushToString(strategy, state);
      const match2 = results2.find((r) => r.isMatch);
      expect(match2).toMatchObject({ streamIndices: [7, 12] });
    });

    it("should produce correct streamIndices after flush with multi-chunk streams", () => {
      const strategy = new RegexSearchStrategy(/world/);
      const state = strategy.createState();

      // Stream 1: two chunks
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      [...strategy.processChunk("hello ", state)];
      const results1 = [...strategy.processChunk("world!", state)];
      flushToString(strategy, state);
      const match1 = results1.find((r) => r.isMatch);
      expect(match1).toMatchObject({ streamIndices: [6, 11] });

      // Stream 2: same content, reused state — should get same indices
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      [...strategy.processChunk("hello ", state)];
      const results2 = [...strategy.processChunk("world!", state)];
      flushToString(strategy, state);
      const match2 = results2.find((r) => r.isMatch);
      expect(match2).toMatchObject({ streamIndices: [6, 11] });
    });
  });

  describe("matchToString", () => {
    it("returns the full matched string (match[0])", () => {
      const strategy = new RegexSearchStrategy(/hello/);
      const state = strategy.createState();
      const results = [...strategy.processChunk("say hello world", state)];
      const match = results.find((r) => r.isMatch)!;
      expect(strategy.matchToString(match.content)).toBe("hello");
    });

    it("returns the full match, not a capture group", () => {
      const strategy = new RegexSearchStrategy(/(\w+)@(\w+)/);
      const state = strategy.createState();
      const results = [
        ...strategy.processChunk("user@example", state),
        ...strategy.flush(state)
      ];
      const match = results.find((r) => r.isMatch)!;
      expect(strategy.matchToString(match.content)).toBe("user@example");
    });
  });

  describe("backreference streaming scenarios", () => {
    describe("numbered backreference matching a repeated token", () => {
      const pattern = /(.+?) \1/;

      it("matches when the repeated word is split across chunks", () => {
        const { results, flush } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          ["foo f", "oo bar"]
        );
        expect(results).toMatchObject([
          { isMatch: true, content: expect.arrayContaining(["foo foo"]) }
        ]);
        expect(flush).toBe(" bar");
      });

      it("matches when the chunk boundary falls between the delimiter and the second occurrence", () => {
        const { results, flush } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          ["foo ", "foo bar"]
        );
        expect(results).toMatchObject([
          { isMatch: true, content: expect.arrayContaining(["foo foo"]) }
        ]);
        expect(flush).toBe(" bar");
      });

      it("matches the same at every two-way, three-way and per-character split", () => {
        expectSameMatchesAtEverySplit(pattern, "foo foo bar", [
          { isMatch: true, text: "foo foo" },
          { isMatch: false, text: " bar" }
        ]);
      });
    });

    describe("named backreference", () => {
      const pattern = /(?<word>\w+) \k<word>/;

      it("matches when the repeated word is split across chunks", () => {
        const { results, flush } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          ["hello hel", "lo world"]
        );
        expect(results).toMatchObject([
          {
            isMatch: true,
            content: expect.objectContaining({
              [0]: "hello hello",
              groups: { word: "hello" }
            })
          },
          { isMatch: false, content: " " }
        ]);

        expect(flush).toBe("world");
      });
    });

    describe("matched tags recipe (HTML/XML-style)", () => {
      const pattern = /<([a-zA-Z][\w:-]*)>[^<]*?<\/\1>/;

      it("matches a tag pair whose name, content, and close are each split across chunks", () => {
        const { results, flush } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          ["<esi:", "include>bo", "dy</esi:in", "clude>tail"]
        );
        expect(results).toMatchObject([
          {
            isMatch: true,
            content: expect.arrayContaining(["<esi:include>body</esi:include>"])
          },
          { isMatch: false, content: "tail" }
        ]);
        expect(flush).toBe("");
      });

      it("captures the tag name via the backreference group", () => {
        const { results, flush } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          ["<div>", "hello", "</div>", " world"]
        );
        const match = results.find((r) => r.isMatch);
        expect(match).toMatchObject({
          content: expect.objectContaining({ 0: "<div>hello</div>", 1: "div" })
        });

        expect(results).toContainEqual({ isMatch: false, content: " world" });
        expect(flush).toBe("");
      });

      it("rejects a mismatched closing tag without buffering indefinitely", () => {
        const { results, flush } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          ["<div>hello</wr", "ong>"]
        );
        expect(results).toMatchObject([
          { isMatch: false, content: "<div>hello</wr" },
          { isMatch: false, content: "ong>" }
        ]);
        expect(flush).toBe("");
      });

      it("does not confuse the tag name between two consecutive matches", () => {
        const { results, flush } = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          ["<a>1</a> and <b", ">2</b> done"]
        );
        const matches = results.filter((r) => r.isMatch);
        expect(matches).toHaveLength(2);
        expect(matches[0]).toMatchObject({
          content: expect.objectContaining({ 0: "<a>1</a>", 1: "a" })
        });
        expect(matches[1]).toMatchObject({
          content: expect.objectContaining({ 0: "<b>2</b>", 1: "b" })
        });
        expect(flush).toBe("");
      });

      it("matches the same at every two-way, three-way and per-character split", () => {
        expectSameMatchesAtEverySplit(
          pattern,
          "head <esi:include>body</esi:include> tail",
          [
            { isMatch: false, text: "head " },
            { isMatch: true, text: "<esi:include>body</esi:include>" },
            { isMatch: false, text: " tail" }
          ]
        );
      });
    });
  });

  describe("zero-length matches", () => {
    const reassemble = (
      results: MatchResult<RegExpExecArray>[],
      flush: string
    ): string =>
      results.map((r) => (r.isMatch ? r.content[0] : r.content)).join("") +
      flush;

    const matchesOf = (results: MatchResult<RegExpExecArray>[]): string[] =>
      results.filter((r) => r.isMatch).map((r) => r.content[0]);

    const emptyPattern = new RegExp("");

    const zeroLengthPatterns: [name: string, pattern: RegExp][] = [
      ["empty pattern", emptyPattern],
      ["empty group", /(?:)/],
      ["optional atom", /a?/],
      ["star quantifier", /a*/],
      ["counted from zero", /a{0,2}/],
      ["empty alternation branch", /x|/],
      ["positive lookahead", /(?=a)/]
    ];

    describe.each(zeroLengthPatterns)("%s: %s", (_name, pattern) => {
      const input = "xaybz";

      it("terminates instead of looping forever, bounded so a regression fails the test rather than exhausting the heap and killing the worker", () => {
        expect(() =>
          collectSearchStrategyResults(new RegexSearchStrategy(pattern), [
            input
          ])
        ).not.toThrow();
      });

      it("terminates when the input is split", () => {
        for (let i = 1; i < input.length; i++) {
          expect(() =>
            collectSearchStrategyResults(new RegexSearchStrategy(pattern), [
              input.slice(0, i),
              input.slice(i)
            ])
          ).not.toThrow();
        }
      });

      it("never yields an empty match, so replacement functions are never invoked with one", () => {
        for (let i = 1; i < input.length; i++) {
          const { results } = collectSearchStrategyResults(
            new RegexSearchStrategy(pattern),
            [input.slice(0, i), input.slice(i)]
          );
          expect(matchesOf(results)).not.toContain("");
        }
      });

      it("is lossless however the input is split", () => {
        const whole = collectSearchStrategyResults(
          new RegexSearchStrategy(pattern),
          [input]
        );
        expect(reassemble(whole.results, whole.flush)).toBe(input);

        for (let i = 1; i < input.length; i++) {
          const { results, flush } = collectSearchStrategyResults(
            new RegexSearchStrategy(pattern),
            [input.slice(0, i), input.slice(i)]
          );
          expect(reassemble(results, flush)).toBe(input);
        }
      });
    });

    describe("documented semantics", () => {
      const cases: [pattern: RegExp, input: string][] = [
        [/a?/, "xaybaaz"],
        [/a*/, "xaayaz"],
        [/\d*/, "a12b3c"],
        [/(ab)?/, "xabyab"],
        [/(ab)*/, "xababyab"],
        [/x|/, "axbxc"],
        [/a?b?/, "xaybzabq"],
        [/(?=a)/, "xaxa"],
        [/(?:)/, "abc"],
        [/(foo)?bar/, "xfoobarybar"],
        [/-?\d+/, "a-12b3"],
        [/(\w+)?;/, "a;bc;"]
      ];

      it.each(cases)(
        "%s matches as matchAll minus empty matches",
        (pattern, input) => {
          const { results, flushResults } = collectSearchStrategyResults(
            new RegexSearchStrategy(pattern),
            [input]
          );
          const expected = [
            ...input.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))
          ]
            .map((m) => m[0])
            .filter((m) => m !== "");

          // A match ending at end-of-input is deferred while it could still
          // grow, and settled by flush() once nothing more can arrive.
          expect(matchesOf([...results, ...flushResults])).toEqual(expected);
        }
      );

      it("never matches at all when the pattern can only ever match empty, failing silently by design", () => {
        for (const pattern of [emptyPattern, /(?:)/, /(?=a)/]) {
          const { results } = collectSearchStrategyResults(
            new RegexSearchStrategy(pattern),
            ["abc"]
          );
          expect(matchesOf(results)).toEqual([]);
        }
      });
    });

    describe("chunk boundaries", () => {
      it("buffers a nullable pattern split mid-token, rather than advancing past the zero-length match and destroying a match more input would have completed", () => {
        const { results, flush, flushResults } = collectSearchStrategyResults(
          new RegexSearchStrategy(/(ab)?/),
          ["a", "b"]
        );
        expect(matchesOf([...results, ...flushResults])).toEqual(["ab"]);
        expect(reassemble(results, flush)).toBe("ab");
      });

      it("yields the same matches at every split point", () => {
        const input = "xabyab";
        const allMatchesOf = (chunks: string[]) => {
          const { results, flushResults } = collectSearchStrategyResults(
            new RegexSearchStrategy(/(ab)?/),
            chunks
          );
          return matchesOf([...results, ...flushResults]);
        };

        const whole = allMatchesOf([input]);
        expect(whole).toEqual(["ab", "ab"]);

        for (let i = 1; i < input.length; i++) {
          expect(allMatchesOf([input.slice(0, i), input.slice(i)])).toEqual(
            whole
          );
        }
      });

      it("passes the character through and advances when no partial match could grow from that position", () => {
        const { results, flush } = collectSearchStrategyResults(
          new RegexSearchStrategy(/(ab)?/),
          ["xy"]
        );
        expect(matchesOf(results)).toEqual([]);
        expect(reassemble(results, flush)).toBe("xy");
      });
    });

    it("emits preceding text as a non-match before buffering, when the partial that preempts a zero-length match starts partway through the chunk", () => {
      const { results, flush } = collectSearchStrategyResults(
        new RegexSearchStrategy(/(?=a)(ab)?/),
        ["ba"]
      );

      expect(results).toEqual([{ isMatch: false, content: "b" }]);
      expect(flush).toBe("a");
    });

    it("completes that buffered partial into a real match once the rest arrives", () => {
      const { results, flushResults } = collectSearchStrategyResults(
        new RegexSearchStrategy(/(?=a)(ab)?/),
        ["ba", "b"]
      );

      expect([...results, ...flushResults]).toMatchObject([
        { isMatch: false, content: "b" },
        { isMatch: true, content: expect.objectContaining({ 0: "ab" }) }
      ]);
    });

    it("emits the text before a skipped zero-length match and the skipped code unit as a single non-match yield, unlike the separate yields a real match produces", () => {
      const { results, flush } = collectSearchStrategyResults(
        new RegexSearchStrategy(/(?=a)/),
        ["xa"]
      );

      expect(results).toEqual([{ isMatch: false, content: "xa" }]);
      expect(flush).toBe("");
    });

    it("advances by one code unit rather than one code point, splitting a surrogate pair but remaining lossless", () => {
      const input = "\u{1F600}";
      expect(input).toHaveLength(2);

      const { results, flush } = collectSearchStrategyResults(
        new RegexSearchStrategy(/a?/),
        [input]
      );
      expect(matchesOf(results)).toEqual([]);
      expect(reassemble(results, flush)).toBe(input);
    });

    it("leaves non-nullable patterns untouched", () => {
      const { results, flush } = collectSearchStrategyResults(
        new RegexSearchStrategy(/\{\{(\w+)\}\}/),
        ["a {{na", "me}} b"]
      );
      expect(matchesOf(results)).toEqual(["{{name}}"]);
      expect(reassemble(results, flush)).toBe("a {{name}} b");
    });
  });
});
