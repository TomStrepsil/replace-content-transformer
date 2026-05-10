import { describe, it, expect } from "vitest";
import { RegexSearchStrategy } from "./search-strategy.js";
import type { MatchResult } from "../types.js";
import validateInput from "./input-validation.js";

vi.mock("./input-validation.js");

// Helper to extract string value from MatchResult
function getValue(result: MatchResult<RegExpExecArray>): string {
  return result.isMatch ? result.content[0] : result.content;
}

describe("RegexSearchStrategy", () => {
  it("should validate input regex", () => {
    const someRegex = /test-regex/;
    new RegexSearchStrategy(someRegex);
    expect(validateInput).toHaveBeenCalledWith(someRegex);
  });

  describe("complete matches in single chunk", () => {
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
        name: "handles patterns that match individual lines in multiline mode (with caveat that when recommended dotAll flag is used, recommended non-greedy matching also used)",
        pattern: /^THE .+? PATTERN$/ms,
        chunks: [
          "Find \nTHE FIRST PATTERN\n here and \nTHE SECOND PATTERN\n there"
        ],
        expected: [
          { isMatch: false, content: "Find \n" },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE FIRST PATTERN"])
          },
          { isMatch: false, content: "\n here and \n" },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE SECOND PATTERN"])
          },
          { isMatch: false, content: "\n there" }
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
        name: "handles patterns with word boundaries",
        pattern: /\bPATTERN\b/,
        chunks: ["PATTERN! NotAPATTERN."],
        expected: [
          { isMatch: true, content: expect.arrayContaining(["PATTERN"]) },
          { isMatch: false, content: "! NotAPATTERN." }
        ]
      },
      {
        name: "handles patterns with input boundary assertions",
        pattern: /^PATTERN$/,
        chunks: ["PATTERN"],
        expected: [
          { isMatch: true, content: expect.arrayContaining(["PATTERN"]) }
        ]
      },
      {
        name: "handles patterns with input boundary assertions (inverse scenario)",
        pattern: /^PATTERN$/,
        chunks: ["the PATTERN here"],
        expected: [{ isMatch: false, content: "the PATTERN here" }]
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
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test.skipIf(
        typeof Bun !== "undefined" &&
          name.includes("complement unicodeSet character classes")
      )(name, () => {
        const strategy = new RegexSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult<RegExpExecArray>[] = [];
        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ isMatch: false, content: flush });

        expect(results).toMatchObject(expected);
      });
    });
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
        const strategy = new RegexSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult<RegExpExecArray>[] = [];
        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ isMatch: false, content: flush });

        expect(results).toMatchObject(expected);
      });
    });
  });

  describe("cross-chunk boundary matches", () => {
    const testCases = [
      {
        name: "pattern split across two chunks - middle",
        pattern: /OLD/,
        chunks: ["Hello O", "LD world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "pattern split at first character",
        pattern: /OLD/,
        chunks: ["Hello ", "OLD world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "pattern split after first character",
        pattern: /OLD/,
        chunks: ["Hello O", "LD world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " world" }
        ]
      },
      {
        name: "pattern split after second character",
        pattern: /OLD/,
        chunks: ["Hello OL", "D world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " world" }
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
        name: "pattern split character by character",
        pattern: /OLD/,
        chunks: ["Hello ", "O", "L", "D", " world"],
        expected: [
          { isMatch: false, content: "Hello " },
          { isMatch: true, content: expect.arrayContaining(["OLD"]) },
          { isMatch: false, content: " world" }
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
        name: "handles patterns with wildcards in the middle, across chunks",
        pattern: /THE .* PATTERN/,
        chunks: ["Find THE COM", "PLEX PATTERN here"],
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
        name: "handles patterns with alternation, across chunks",
        pattern: /(FIRST|SECOND) PATTERN/,
        chunks: ["Find FIR", "ST PATTERN and SE", "COND PATTERN here"],
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
        name: "handles multiple patterns with wildcards in the middle, using non-greedy matching, across chunks",
        pattern: /THE .*? PATTERN/,
        chunks: [
          "Find THE FIR",
          "ST PATTERN he",
          "re and THE SECOND PATTERN there"
        ],
        expected: [
          { isMatch: false, content: "Find " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE FIRST PATTERN"])
          },
          { isMatch: false, content: " he" },
          { isMatch: false, content: "re and " },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE SECOND PATTERN"])
          },
          { isMatch: false, content: " there" }
        ]
      },
      {
        name: "handles patterns with character ranges and quantifiers, across chunks",
        pattern: /THE [A-Z]{3}PLEX PATTERN/,
        chunks: ["Find THE CO", "MPLEX PATTERN here"],
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
        name: "handles wildcards at the start, across chunks",
        pattern: /.+?PLEX PATTERN/,
        chunks: ["Find T", "HE CO", "MPLEX PATTERN here"],
        expected: [
          {
            isMatch: true,
            content: expect.arrayContaining(["Find THE COMPLEX PATTERN"])
          },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles wildcards at the end, across chunks (with caveat, will yield optimistically only to end of chunk, on unbounded wildcard)",
        pattern: /COMPLEX PATTERN.+/,
        chunks: ["Find THE COMPLEX PATTE", "RN he", "re"],
        expected: [
          { isMatch: false, content: "Find THE " },
          {
            isMatch: true,
            content: expect.arrayContaining(["COMPLEX PATTERN he"])
          },
          { isMatch: false, content: "re" }
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
        name: "handles patterns that match individual lines in multiline mode, across chunks (with caveat, that the dotAll flag must be used)",
        pattern: /^THE .+ PATTERN$/ms,
        chunks: [
          "Find \nTHE FI",
          "RST PATTERN\n here and \nTHE SECOND PA",
          "TTERN\n there"
        ],
        expected: [
          { isMatch: false, content: "Find \n" },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE FIRST PATTERN"])
          },
          { isMatch: false, content: "\n here and \n" },
          {
            isMatch: true,
            content: expect.arrayContaining(["THE SECOND PATTERN"])
          },
          { isMatch: false, content: "\n there" }
        ]
      },
      {
        name: "handles patterns with positive lookahead, across chunks",
        pattern: /THE COMPLEX PATTERN(?= here)/,
        chunks: ["Find THE COMPLEX PATTERN", " here"],
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
        name: "handles patterns with positive lookahead (inverse scenario), across chunks",
        pattern: /THE COMPLEX PATTERN(?= here)/,
        chunks: ["Find THE COMPLEX PATTERN", " not here"],
        expected: [
          { isMatch: false, content: "Find " },
          { isMatch: false, content: "THE COMPLEX PATTERN not here" }
        ]
      },
      {
        name: "handles patterns with word boundaries, across chunks",
        pattern: /\bPATTERN\b/,
        chunks: ["PATT", "ERN! NotAP", "ATTERN."],
        expected: [
          { isMatch: true, content: expect.arrayContaining(["PATTERN"]) },
          { isMatch: false, content: "! NotAP" },
          { isMatch: false, content: "ATTERN." }
        ]
      },
      {
        name: "handles patterns with input boundary assertions, across chunks",
        pattern: /^PATTERN$/,
        chunks: ["PAT", "TERN"],
        expected: [
          { isMatch: true, content: expect.arrayContaining(["PATTERN"]) }
        ]
      },
      {
        name: "handles patterns with input boundary assertions (inverse scenario), across chunks",
        pattern: /^PATTERN$/,
        chunks: ["the PAT", "TERN here"],
        expected: [
          { isMatch: false, content: "the PAT" },
          { isMatch: false, content: "TERN here" }
        ]
      },
      {
        name: "handles patterns with escaped characters, across chunks",
        pattern: /THE \.COMPLEX \?PATTERN\*/,
        chunks: ["Find THE .COMP", "LEX ?PATTERN* here"],
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
        name: "handles patterns with character classes, across chunks (with caveat that multiple matches may occur)",
        pattern: /[A-Z]+/,
        chunks: ["find PAT", "TERN here"],
        expected: [
          { isMatch: false, content: "find " },
          { isMatch: true, content: expect.arrayContaining(["PAT"]) },
          { isMatch: true, content: expect.arrayContaining(["TERN"]) },
          { isMatch: false, content: " here" }
        ]
      },
      {
        name: "handles patterns with unicode characters and emojis, across chunks",
        pattern: /(こんにちは|👋)/,
        chunks: ["Say こん", "にちは to everyone ", "👋"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こんにちは"]) },
          { isMatch: false, content: " to everyone " },
          { isMatch: true, content: expect.arrayContaining(["👋"]) }
        ]
      },
      {
        name: "handles patterns with unicode character class escapes, across chunks (with caveat that multiple matches may occur)",
        pattern: /\p{Script=Hiragana}+/u,
        chunks: ["Say こんに", "ちは to everyone"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こんに"]) },
          { isMatch: true, content: expect.arrayContaining(["ちは"]) },
          { isMatch: false, content: " to everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}]+/v,
        chunks: ["Say こん", "にちは to everyone"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こん"]) },
          { isMatch: true, content: expect.arrayContaining(["にちは"]) },
          { isMatch: false, content: " to everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes (inverse scenario), across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}]+/v,
        chunks: ["Say konn", "ichiwa to everyone"],
        expected: [
          { isMatch: false, content: "Say konn" },
          { isMatch: false, content: "ichiwa to everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes with intersections, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}&&\p{Alphabetic}]+/v,
        chunks: ["Say こんに", "ちは to everyone"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こんに"]) },
          { isMatch: true, content: expect.arrayContaining(["ちは"]) },
          { isMatch: false, content: " to everyone" }
        ]
      },
      {
        name: "handles patterns with complement unicodeSet character classes with intersections, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\P{Script=Hiragana}&&\P{Alphabetic}]+/v,
        chunks: ["Say こんに", "ちは12", "3 to everyone"],
        expected: [
          { isMatch: false, content: "Say" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "こんに" },
          { isMatch: false, content: "ちは" },
          { isMatch: true, content: expect.arrayContaining(["12"]) },
          { isMatch: true, content: expect.arrayContaining(["3 "]) },
          { isMatch: false, content: "to" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet union character classes, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}\p{Alphabetic}]+/v,
        chunks: ["Say こん", "にちは to everyone"],
        expected: [
          { isMatch: true, content: expect.arrayContaining(["Say"]) },
          { isMatch: false, content: " " },
          { isMatch: true, content: expect.arrayContaining(["こん"]) },
          { isMatch: true, content: expect.arrayContaining(["にちは"]) },
          { isMatch: false, content: " " },
          { isMatch: true, content: expect.arrayContaining(["to"]) },
          { isMatch: false, content: " " },
          { isMatch: true, content: expect.arrayContaining(["everyone"]) }
        ]
      },
      {
        name: "handles patterns with unicodeSet union character classes, negated, across chunks (with caveat that multiple matches may occur)",
        pattern: /[^\p{Script=Hiragana}\p{Alphabetic}]+/v,
        chunks: ["Say こんに", "ちは to everyone"],
        expected: [
          { isMatch: false, content: "Say" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "こんに" },
          { isMatch: false, content: "ちは" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "to" },
          { isMatch: true, content: expect.arrayContaining([" "]) },
          { isMatch: false, content: "everyone" }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes with subtraction, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}--[ちは]]+/v,
        chunks: ["Say こん", "にちは to everyone"],
        expected: [
          { isMatch: false, content: "Say " },
          { isMatch: true, content: expect.arrayContaining(["こん"]) },
          { isMatch: true, content: expect.arrayContaining(["に"]) },
          { isMatch: false, content: "ちは to everyone" }
        ]
      },
      {
        name: "handles patterns with capturing groups, returning them with the content (plus the whole match at index 0, to match RegExpExecArray interface), across chunks",
        pattern: /(THE)( PATTERN)/,
        chunks: ["Find TH", "E PAT", "TERN here"],
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
        name: "handles patterns with non-capturing groups, across chunks",
        pattern: /(THE)(?: PATTERN)/,
        chunks: ["Find THE P", "ATTERN here"],
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
        name: "handles patterns with named capturing groups, across chunks",
        pattern: /(?<first>THE)(?<second> PATTERN)/,
        chunks: ["Find TH", "E PA", "TTERN here"],
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
        name: "handles patterns with both named and unnamed capturing groups, cross chunks",
        pattern: /(THE)(?<second> PATTERN)/,
        chunks: ["Find THE", " PATTER", "N here"],
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
        name: "returns multiple matches for surrogate pairs when matching as a single character, via the unicode flag, across chunks",
        pattern: /(?<foo>.)/u,
        chunks: ["\ud83d", "\ude04"],
        expected: [
          {
            isMatch: true,
            content: expect.objectContaining({ groups: { foo: "\ud83d" } })
          },
          {
            isMatch: true,
            content: expect.objectContaining({ groups: { foo: "\ude04" } })
          }
        ]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test.skipIf(
        typeof Bun !== "undefined" &&
          name.includes("complement unicodeSet character classes")
      )(name, () => {
        const strategy = new RegexSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult<RegExpExecArray>[] = [];
        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ isMatch: false, content: flush });

        expect(results).toMatchObject(expected);
      });
    });
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
          const strategy = new RegexSearchStrategy(pattern);
          const state = strategy.createState();
          const results: MatchResult<RegExpExecArray>[] = [];
          for (const chunk of chunks) {
            for (const result of strategy.processChunk(chunk, state)) {
              results.push(result);
            }
          }

          const flush = strategy.flush(state);
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
        const strategy = new RegexSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult<RegExpExecArray>[] = [];
        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        expect(results).toMatchObject(expected);
      });
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
      expect(strategy.flush(state)).toBe("");
      expect(outputs).toMatchObject(["Text with "]);
    });

    it("has no remainder when cancelling with only buffered partial match (mid first anchor)", () => {
      const strategy = new RegexSearchStrategy(/{{.+?}}/s);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text with {", state);
      outputs.push(getValue(generator.next().value!));
      const remainder = generator.return().value;
      outputs.push(strategy.flush(state));
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
      expect(strategy.flush(state)).toBe(" and {{ something more }}");
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
      const results1 = [...strategy.processChunk("OLD", state1)];
      const match1 = results1.find((r) => r.isMatch);
      expect(match1?.streamIndices[0]).toBe(0);

      const state2 = strategy.createState();
      const results2 = [...strategy.processChunk("OLD", state2)];
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
      strategy.flush(state);
      const match1 = results1.find((r) => r.isMatch);
      expect(match1).toMatchObject({ streamIndices: [7, 12] });

      // Stream 2: reuse state after flush — indices should start from 0 again
      const results2 = [...strategy.processChunk("prefix hello suffix", state)];
      strategy.flush(state);
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
      strategy.flush(state);
      const match1 = results1.find((r) => r.isMatch);
      expect(match1).toMatchObject({ streamIndices: [6, 11] });

      // Stream 2: same content, reused state — should get same indices
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      [...strategy.processChunk("hello ", state)];
      const results2 = [...strategy.processChunk("world!", state)];
      strategy.flush(state);
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
      const results = [...strategy.processChunk("user@example", state)];
      const match = results.find((r) => r.isMatch)!;
      expect(strategy.matchToString(match.content)).toBe("user@example");
    });
  });
});
