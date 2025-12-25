import { describe, it, expect } from "vitest";
import { RegexSearchStrategy } from "./search-strategy.ts";
import type { MatchResult } from "../types.ts";
import validateInput from "./input-validation.ts";

vi.mock("./input-validation.ts");

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
        expected: [{ content: "something else", match: false }]
      },
      {
        name: "finds pattern when haystack equals pattern",
        pattern: /OLD/,
        chunks: ["OLD"],
        expected: [{ content: "OLD", match: true }]
      },
      {
        name: "finds pattern at start of chunk",
        pattern: /OLD/,
        chunks: ["OLDtext"],
        expected: [
          { content: "OLD", match: true },
          { content: "text", match: false }
        ]
      },
      {
        name: "finds pattern at end of chunk",
        pattern: /OLD/,
        chunks: ["textOLD"],
        expected: [
          { content: "text", match: false },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "finds pattern in middle of chunk",
        pattern: /OLD/,
        chunks: ["Hello OLD world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "finds each occurrence when pattern appears multiple times",
        pattern: /OLD/,
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
        pattern: /OLD/,
        chunks: ["OLDOLD"],
        expected: [
          { content: "OLD", match: true },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "handles single character pattern",
        pattern: /X/,
        chunks: ["test X test"],
        expected: [
          { content: "test ", match: false },
          { content: "X", match: true },
          { content: " test", match: false }
        ]
      },
      {
        name: "handles long multi-character pattern, with whitespace",
        pattern: /THE COMPLEX PATTERN/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with wildcards in the middle",
        pattern: /THE .* PATTERN/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with alternation",
        pattern: /(FIRST|SECOND) PATTERN/,
        chunks: ["Find FIRST PATTERN and SECOND PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "FIRST PATTERN", match: true },
          { content: " and ", match: false },
          { content: "SECOND PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles multiple patterns with wildcards in the middle, using non-greedy matching",
        pattern: /THE .*? PATTERN/,
        chunks: ["Find THE FIRST PATTERN here and THE SECOND PATTERN there"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE FIRST PATTERN", match: true },
          { content: " here and ", match: false },
          { content: "THE SECOND PATTERN", match: true },
          { content: " there", match: false }
        ]
      },
      {
        name: "handles patterns with character ranges",
        pattern: /[A-Z]+/,
        chunks: ["find PATTERN here"],
        expected: [
          { content: "find ", match: false },
          { content: "PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with character ranges and quantifiers",
        pattern: /THE [A-Z]{3}PLEX PATTERN/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles wildcards at the start",
        pattern: /.+?PLEX PATTERN/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { content: "Find THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles wildcards at the end",
        pattern: /COMPLEX PATTERN.+/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { content: "Find THE ", match: false },
          { content: "COMPLEX PATTERN here", match: true }
        ]
      },
      {
        name: "handles case-insensitive patterns",
        pattern: /THE COMPLEX PATTERN/i,
        chunks: ["Find The cOmPlEx PATtern here"],
        expected: [
          { content: "Find ", match: false },
          { content: "The cOmPlEx PATtern", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns that wildcard over newlines",
        pattern: /THE .+ PATTERN/s,
        chunks: ["Find THE COMP\nLEX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMP\nLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns that match individual lines in multiline mode (with caveat that when recommended dotAll flag is used, recommended non-greedy matching also used)",
        pattern: /^THE .+? PATTERN$/ms,
        chunks: [
          "Find \nTHE FIRST PATTERN\n here and \nTHE SECOND PATTERN\n there"
        ],
        expected: [
          { content: "Find \n", match: false },
          { content: "THE FIRST PATTERN", match: true },
          { content: "\n here and \n", match: false },
          { content: "THE SECOND PATTERN", match: true },
          { content: "\n there", match: false }
        ]
      },
      {
        name: "handles patterns with positive lookahead",
        pattern: /THE COMPLEX PATTERN(?= here)/,
        chunks: ["Find THE COMPLEX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with positive lookahead (inverse scenario)",
        pattern: /THE COMPLEX PATTERN(?= here)/,
        chunks: ["Find THE COMPLEX PATTERN not here"],
        expected: [
          { content: "Find THE COMPLEX PATTERN not here", match: false }
        ]
      },
      {
        name: "handles patterns with word boundaries",
        pattern: /\bPATTERN\b/,
        chunks: ["PATTERN! NotAPATTERN."],
        expected: [
          { content: "PATTERN", match: true },
          { content: "! NotAPATTERN.", match: false }
        ]
      },
      {
        name: "handles patterns with input boundary assertions",
        pattern: /^PATTERN$/,
        chunks: ["PATTERN"],
        expected: [{ content: "PATTERN", match: true }]
      },
      {
        name: "handles patterns with input boundary assertions (inverse scenario)",
        pattern: /^PATTERN$/,
        chunks: ["the PATTERN here"],
        expected: [{ content: "the PATTERN here", match: false }]
      },
      {
        name: "handles patterns with escaped characters",
        pattern: /THE \.COMPLEX \?PATTERN\*/,
        chunks: ["Find THE .COMPLEX ?PATTERN* here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE .COMPLEX ?PATTERN*", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with Unicode characters and emojis",
        pattern: /(こんにちは|👋)/,
        chunks: ["Say こんにちは to everyone 👋"],
        expected: [
          { content: "Say ", match: false },
          { content: "こんにちは", match: true },
          { content: " to everyone ", match: false },
          { content: "👋", match: true }
        ]
      },
      {
        name: "handles patterns with unicode character class escapes",
        pattern: /\p{Script=Hiragana}+/u,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { content: "Say ", match: false },
          { content: "こんにちは", match: true },
          { content: " to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes",
        pattern: /[\p{Script=Hiragana}]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { content: "Say ", match: false },
          { content: "こんにちは", match: true },
          { content: " to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet inverse character classes",
        pattern: /[\p{Script=Hiragana}]+/v,
        chunks: ["Say konnichiwa to everyone"],
        expected: [{ content: "Say konnichiwa to everyone", match: false }]
      },
      {
        name: "handles patterns with unicodeSet character classes with intersections",
        pattern: /[\p{Script=Hiragana}&&\p{Alphabetic}]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { content: "Say ", match: false },
          { content: "こんにちは", match: true },
          { content: " to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with complement unicodeSet character classes with intersections",
        pattern: /[\P{Script=Hiragana}&&\P{Alphabetic}]+/v,
        chunks: ["Say こんにちは123 to everyone"],
        expected: [
          { content: "Say", match: false },
          { content: " ", match: true },
          { content: "こんにちは", match: false },
          { content: "123 ", match: true },
          { content: "to", match: false },
          { content: " ", match: true },
          { content: "everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet union character classes",
        pattern: /[\p{Script=Hiragana}\p{Alphabetic}]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { content: "Say", match: true },
          { content: " ", match: false },
          { content: "こんにちは", match: true },
          { content: " ", match: false },
          { content: "to", match: true },
          { content: " ", match: false },
          { content: "everyone", match: true }
        ]
      },
      {
        name: "handles patterns with unicodeSet union character classes, negated",
        pattern: /[^\p{Script=Hiragana}\p{Alphabetic}]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { content: "Say", match: false },
          { content: " ", match: true },
          { content: "こんにちは", match: false },
          { content: " ", match: true },
          { content: "to", match: false },
          { content: " ", match: true },
          { content: "everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes with subtraction",
        pattern: /[\p{Script=Hiragana}--[ちは]]+/v,
        chunks: ["Say こんにちは to everyone"],
        expected: [
          { content: "Say ", match: false },
          { content: "こんに", match: true },
          { content: "ちは to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with capturing groups, returning them with the content (plus the whole match at index 0, to match RegExpExecArray interface)",
        pattern: /(THE)( PATTERN)/,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          {
            content: "THE PATTERN",
            match: true,
            [0]: "THE PATTERN",
            [1]: "THE",
            [2]: " PATTERN"
          },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with non-capturing groups",
        pattern: /(THE)(?: PATTERN)/,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          {
            content: "THE PATTERN",
            match: true,
            [0]: "THE PATTERN",
            [1]: "THE"
          },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with named capturing groups",
        pattern: /(?<first>THE)(?<second> PATTERN)/,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          {
            content: "THE PATTERN",
            match: true,
            groups: { first: "THE", second: " PATTERN" }
          },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with both named and unnamed capturing groups",
        pattern: /(THE)(?<second> PATTERN)/,
        chunks: ["Find THE PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          {
            content: "THE PATTERN",
            match: true,
            [0]: "THE PATTERN",
            [1]: "THE",
            groups: { second: " PATTERN" }
          },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with astral characters matching as a single character, via the unicode flag",
        pattern: /./u,
        chunks: ["\ud83d\ude04"], // "😄"
        expected: [{ content: "😄", match: true }]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const strategy = new RegexSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult[] = [];
        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ content: flush, match: false });

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
        expected: [{ content: "Hello beautiful world", match: false }]
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
        expected: [{ content: "OLD", match: false }]
      },
      {
        name: "case sensitive - uppercase pattern vs lowercase haystack",
        pattern: /OLD/,
        chunks: ["old"],
        expected: [{ content: "old", match: false }]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const strategy = new RegexSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult[] = [];
        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ content: flush, match: false });

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
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "pattern split at first character",
        pattern: /OLD/,
        chunks: ["Hello ", "OLD world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "pattern split after first character",
        pattern: /OLD/,
        chunks: ["Hello O", "LD world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "pattern split after second character",
        pattern: /OLD/,
        chunks: ["Hello OL", "D world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "pattern split across three chunks",
        pattern: /PATTERN/,
        chunks: ["Find PAT", "TER", "N here"],
        expected: [
          { content: "Find ", match: false },
          { content: "PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "pattern split character by character",
        pattern: /OLD/,
        chunks: ["Hello ", "O", "L", "D", " world"],
        expected: [
          { content: "Hello ", match: false },
          { content: "OLD", match: true },
          { content: " world", match: false }
        ]
      },
      {
        name: "incomplete pattern at end of first chunk, complete in second",
        pattern: /OLD/,
        chunks: ["text O", "LD more"],
        expected: [
          { content: "text ", match: false },
          { content: "OLD", match: true },
          { content: " more", match: false }
        ]
      },
      {
        name: "false start - partial match fails, then completes in next chunk",
        pattern: /OLD/,
        chunks: ["OL OL", "D"],
        expected: [
          { content: "OL ", match: false },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "overlapping pattern across chunks",
        pattern: /OLD/,
        chunks: ["OLOL", "D"],
        expected: [
          { content: "OL", match: false },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "wild-carded patterns across chunks",
        pattern: /THE .+? PATTERN/,
        chunks: ["Find TH", "E COMPL", "EX ", "PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with wildcards in the middle, across chunks",
        pattern: /THE .* PATTERN/,
        chunks: ["Find THE COM", "PLEX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with alternation, across chunks",
        pattern: /(FIRST|SECOND) PATTERN/,
        chunks: ["Find FIR", "ST PATTERN and SE", "COND PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "FIRST PATTERN", match: true },
          { content: " and ", match: false },
          { content: "SECOND PATTERN", match: true },
          { content: " here", match: false }
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
          { content: "Find ", match: false },
          { content: "THE FIRST PATTERN", match: true },
          { content: " he", match: false },
          { content: "re and ", match: false },
          { content: "THE SECOND PATTERN", match: true },
          { content: " there", match: false }
        ]
      },
      {
        name: "handles patterns with character ranges and quantifiers, across chunks",
        pattern: /THE [A-Z]{3}PLEX PATTERN/,
        chunks: ["Find THE CO", "MPLEX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles wildcards at the start, across chunks",
        pattern: /.+?PLEX PATTERN/,
        chunks: ["Find T", "HE CO", "MPLEX PATTERN here"],
        expected: [
          { content: "Find THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles wildcards at the end, across chunks (with caveat, will yield optimistically only to end of chunk, on unbounded wildcard)",
        pattern: /COMPLEX PATTERN.+/,
        chunks: ["Find THE COMPLEX PATTE", "RN he", "re"],
        expected: [
          { content: "Find THE ", match: false },
          { content: "COMPLEX PATTERN he", match: true },
          { content: "re", match: false }
        ]
      },
      {
        name: "handles patterns that wildcard over newlines, across chunks",
        pattern: /THE .+? PATTERN/s,
        chunks: ["Find THE CO", "MP\nL", "EX PATTERN here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMP\nLEX PATTERN", match: true },
          { content: " here", match: false }
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
          { content: "Find \n", match: false },
          { content: "THE FIRST PATTERN", match: true },
          { content: "\n here and \n", match: false },
          { content: "THE SECOND PATTERN", match: true },
          { content: "\n there", match: false }
        ]
      },
      {
        name: "handles patterns with positive lookahead, across chunks",
        pattern: /THE COMPLEX PATTERN(?= here)/,
        chunks: ["Find THE COMPLEX PATTERN", " here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with positive lookahead (inverse scenario), across chunks",
        pattern: /THE COMPLEX PATTERN(?= here)/,
        chunks: ["Find THE COMPLEX PATTERN", " not here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE COMPLEX PATTERN not here", match: false }
        ]
      },
      {
        name: "handles patterns with word boundaries, across chunks",
        pattern: /\bPATTERN\b/,
        chunks: ["PATT", "ERN! NotAP", "ATTERN."],
        expected: [
          { content: "PATTERN", match: true },
          { content: "! NotAP", match: false },
          { content: "ATTERN.", match: false }
        ]
      },
      {
        name: "handles patterns with input boundary assertions, across chunks",
        pattern: /^PATTERN$/,
        chunks: ["PAT", "TERN"],
        expected: [{ content: "PATTERN", match: true }]
      },
      {
        name: "handles patterns with input boundary assertions (inverse scenario), across chunks",
        pattern: /^PATTERN$/,
        chunks: ["the PAT", "TERN here"],
        expected: [
          { content: "the PAT", match: false },
          { content: "TERN here", match: false }
        ]
      },
      {
        name: "handles patterns with escaped characters, across chunks",
        pattern: /THE \.COMPLEX \?PATTERN\*/,
        chunks: ["Find THE .COMP", "LEX ?PATTERN* here"],
        expected: [
          { content: "Find ", match: false },
          { content: "THE .COMPLEX ?PATTERN*", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with character classes, across chunks (with caveat that multiple matches may occur)",
        pattern: /[A-Z]+/,
        chunks: ["find PAT", "TERN here"],
        expected: [
          { content: "find ", match: false },
          { content: "PAT", match: true },
          { content: "TERN", match: true },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with unicode characters and emojis, across chunks",
        pattern: /(こんにちは|👋)/,
        chunks: ["Say こん", "にちは to everyone ", "👋"],
        expected: [
          { content: "Say ", match: false },
          { content: "こんにちは", match: true },
          { content: " to everyone ", match: false },
          { content: "👋", match: true }
        ]
      },
      {
        name: "handles patterns with unicode character class escapes, across chunks (with caveat that multiple matches may occur)",
        pattern: /\p{Script=Hiragana}+/u,
        chunks: ["Say こんに", "ちは to everyone"],
        expected: [
          { content: "Say ", match: false },
          { content: "こんに", match: true },
          { content: "ちは", match: true },
          { content: " to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}]+/v,
        chunks: ["Say こん", "にちは to everyone"],
        expected: [
          { content: "Say ", match: false },
          { content: "こん", match: true },
          { content: "にちは", match: true },
          { content: " to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet inverse character classes, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}]+/v,
        chunks: ["Say konn", "ichiwa to everyone"],
        expected: [
          { content: "Say konn", match: false },
          { content: "ichiwa to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes with intersections, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}&&\p{Alphabetic}]+/v,
        chunks: ["Say こんに", "ちは to everyone"],
        expected: [
          { content: "Say ", match: false },
          { content: "こんに", match: true },
          { content: "ちは", match: true },
          { content: " to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with complement unicodeSet character classes with intersections, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\P{Script=Hiragana}&&\P{Alphabetic}]+/v,
        chunks: ["Say こんに", "ちは12", "3 to everyone"],
        expected: [
          { content: "Say", match: false },
          { content: " ", match: true },
          { content: "こんに", match: false },
          { content: "ちは", match: false },
          { content: "12", match: true },
          { content: "3 ", match: true },
          { content: "to", match: false },
          { content: " ", match: true },
          { content: "everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet union character classes, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}\p{Alphabetic}]+/v,
        chunks: ["Say こん", "にちは to everyone"],
        expected: [
          { content: "Say", match: true },
          { content: " ", match: false },
          { content: "こん", match: true },
          { content: "にちは", match: true },
          { content: " ", match: false },
          { content: "to", match: true },
          { content: " ", match: false },
          { content: "everyone", match: true }
        ]
      },
      {
        name: "handles patterns with unicodeSet union character classes, negated, across chunks (with caveat that multiple matches may occur)",
        pattern: /[^\p{Script=Hiragana}\p{Alphabetic}]+/v,
        chunks: ["Say こんに", "ちは to everyone"],
        expected: [
          { content: "Say", match: false },
          { content: " ", match: true },
          { content: "こんに", match: false },
          { content: "ちは", match: false },
          { content: " ", match: true },
          { content: "to", match: false },
          { content: " ", match: true },
          { content: "everyone", match: false }
        ]
      },
      {
        name: "handles patterns with unicodeSet character classes with subtraction, across chunks (with caveat that multiple matches may occur)",
        pattern: /[\p{Script=Hiragana}--[ちは]]+/v,
        chunks: ["Say こん", "にちは to everyone"],
        expected: [
          { content: "Say ", match: false },
          { content: "こん", match: true },
          { content: "に", match: true },
          { content: "ちは to everyone", match: false }
        ]
      },
      {
        name: "handles patterns with capturing groups, returning them with the content (plus the whole match at index 0, to match RegExpExecArray interface), across chunks",
        pattern: /(THE)( PATTERN)/,
        chunks: ["Find TH", "E PAT", "TERN here"],
        expected: [
          { content: "Find ", match: false },
          {
            content: "THE PATTERN",
            match: true,
            [0]: "THE PATTERN",
            [1]: "THE",
            [2]: " PATTERN"
          },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with non-capturing groups, across chunks",
        pattern: /(THE)(?: PATTERN)/,
        chunks: ["Find THE P", "ATTERN here"],
        expected: [
          { content: "Find ", match: false },
          {
            content: "THE PATTERN",
            match: true,
            [0]: "THE PATTERN",
            [1]: "THE"
          },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with named capturing groups, across chunks",
        pattern: /(?<first>THE)(?<second> PATTERN)/,
        chunks: ["Find TH", "E PA", "TTERN here"],
        expected: [
          { content: "Find ", match: false },
          {
            content: "THE PATTERN",
            match: true,
            groups: { first: "THE", second: " PATTERN" }
          },
          { content: " here", match: false }
        ]
      },
      {
        name: "handles patterns with both named and unnamed capturing groups, cross chunks",
        pattern: /(THE)(?<second> PATTERN)/,
        chunks: ["Find THE", " PATTER", "N here"],
        expected: [
          { content: "Find ", match: false },
          {
            content: "THE PATTERN",
            match: true,
            [0]: "THE PATTERN",
            [1]: "THE",
            groups: { second: " PATTERN" }
          },
          { content: " here", match: false }
        ]
      },
      {
        name: "returns multiple matches for surrogate pairs when matching as a single character, via the unicode flag, across chunks",
        pattern: /(?<foo>.)/u,
        chunks: ["\ud83d", "\ude04"],
        expected: [
          { content: "\ud83d", match: true, groups: { foo: "\ud83d" } },
          { content: "\ude04", match: true, groups: { foo: "\ude04" } }
        ]
      }
    ];

    testCases.forEach(({ name, pattern, chunks, expected }) => {
      test(name, () => {
        const strategy = new RegexSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult[] = [];
        for (const chunk of chunks) {
          for (const result of strategy.processChunk(chunk, state)) {
            results.push(result);
          }
        }

        const flush = strategy.flush(state);
        if (flush) results.push({ content: flush, match: false });

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
        expectedYields: [{ content: "text ", match: false }],
        expectedFlush: "O"
      },
      {
        name: "partial match at end - two characters",
        pattern: /OLD/,
        chunks: ["text OL"],
        expectedYields: [{ content: "text ", match: false }],
        expectedFlush: "OL"
      },
      {
        name: "partial match at end - longest partial",
        pattern: /ABCDEF/,
        chunks: ["text ABCD"],
        expectedYields: [{ content: "text ", match: false }],
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
        expectedYields: [{ content: "OL", match: false }],
        expectedFlush: "OL"
      }
    ];

    testCases.forEach(
      ({ name, pattern, chunks, expectedYields, expectedFlush }) => {
        test(name, () => {
          const strategy = new RegexSearchStrategy(pattern);
          const state = strategy.createState();
          const results: MatchResult[] = [];
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
          { content: "First ", match: false },
          { content: "OLD", match: true },
          { content: " and second ", match: false },
          { content: "OLD", match: true }
        ]
      },
      {
        name: "match at end of first chunk, match at start of second",
        pattern: /OLD/,
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
        pattern: /OLD/,
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
        const strategy = new RegexSearchStrategy(pattern);
        const state = strategy.createState();
        const results: MatchResult[] = [];
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
      outputs.push(generator.next().value!.content);
      expect(generator.return().value).toBeUndefined();
      expect(strategy.flush(state)).toBe("");
      expect(outputs).toMatchObject(["Text with "]);
    });

    it("has no remainder when cancelling with only buffered partial match (mid first anchor)", () => {
      const strategy = new RegexSearchStrategy(/{{.+?}}/s);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text with {", state);
      outputs.push(generator.next().value!.content);
      const remainder = generator.return().value;
      outputs.push(strategy.flush(state));
      expect(remainder).toBeUndefined();
      expect(outputs).toMatchObject(["Text with ", "{"]);
    });

    it("has appropriate flush when cancelling after a match, with matches remaining", () => {
      const strategy = new RegexSearchStrategy(/{{.+?}}/s);
      const state = strategy.createState();

      const outputs: MatchResult[] = [];

      for (const value of strategy.processChunk(
        "Text with {{ something }} and {{ something more }}",
        state
      )) {
        outputs.push(value);
        if (outputs.length === 2) break;
      }
      expect(outputs).toMatchObject([
        { content: "Text with ", match: false },
        { content: "{{ something }}", match: true }
      ]);
      expect(strategy.flush(state)).toBe(" and {{ something more }}");
    });
  });
});
