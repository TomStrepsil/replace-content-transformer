import { describe, it, expect, vi } from "vitest";
import CorePartialMatchRegExp, { withModules, type PartialMatchRegExp } from "regex-partial-match/core";
import backreferences from "regex-partial-match/modules/backreferences";
import { LeanRegexSearchStrategy } from "./lean-search-strategy.js";
import { RegexSearchStrategy } from "./search-strategy.js";
import type { RegexSearchStrategyOptions, RegexSearchState, StreamRegexMatch } from "./types.js";
import type { SearchStrategy } from "../types.js";
import {
  collectSearchStrategyResults,
  regexMatchDetailsOf
} from "../../../test/utilities.js";
import { everySplitOf } from "../../../test/splits.js";

const WithBackreferences = withModules(backreferences);

function streamed(
  strategy: SearchStrategy<RegexSearchState, StreamRegexMatch>,
  chunks: string[]
) {
  const collected = collectSearchStrategyResults(strategy, chunks);
  return {
    output: collected.output,
    matches: regexMatchDetailsOf(collected)
  };
}

describe("LeanRegexSearchStrategy", () => {
  it("should reject a plain RegExp in place of a PartialMatchRegExp", () => {
    expect(
      () => new LeanRegexSearchStrategy(/plain/ as unknown as PartialMatchRegExp)
    ).toThrow(TypeError);
  });

  it("should reject an unsupported construct as RegexSearchStrategy does", () => {
    expect(
      () => new LeanRegexSearchStrategy(new CorePartialMatchRegExp(/a(?!b)/))
    ).toThrow("negative lookaheads are not supported");
  });

  it("should reject invalid options as RegexSearchStrategy does", () => {
    expect(
      () =>
        new LeanRegexSearchStrategy(new CorePartialMatchRegExp(/a/), {
          maxBufferLength: -1
        })
    ).toThrow(RangeError);
  });

  describe.each([
    {
      name: "a core pattern with a capture",
      pattern: /\{\{(\w+)\}\}/,
      haystack: "a {{name}} b {{x}} {{",
      build: (pattern: RegExp) => new CorePartialMatchRegExp(pattern)
    },
    {
      name: "a core pattern with a lookahead, named groups and the d flag",
      pattern: /(?<word>[A-Z]+)(?=!)/d,
      haystack: "MAT CH! OK! NO",
      build: (pattern: RegExp) => new CorePartialMatchRegExp(pattern)
    },
    {
      name: "a backreference pattern bound to the backreferences module",
      pattern: /(["'])(.*?)\1/,
      haystack: `say "hi" and 'yo" or' "`,
      build: (pattern: RegExp) => new WithBackreferences(pattern)
    }
  ])("given $name", ({ pattern, haystack, build }) => {
    it("should stream the same results as RegexSearchStrategy at every split", () => {
      for (const chunks of everySplitOf(haystack)) {
        expect({
          chunks,
          ...streamed(new LeanRegexSearchStrategy(build(pattern)), chunks)
        }).toEqual({
          chunks,
          ...streamed(new RegexSearchStrategy(pattern), chunks)
        });
      }
    });
  });

  it("should apply its options as RegexSearchStrategy does", () => {
    const guardCalls = (
      create: (options: RegexSearchStrategyOptions) => LeanRegexSearchStrategy
    ) => {
      const onGuardExceeded = vi.fn();
      const strategy = create({ maxBufferLength: 4, onGuardExceeded });
      const { output } = collectSearchStrategyResults(strategy, [
        "ab",
        "cdef",
        "gh ij"
      ]);
      return { output, calls: onGuardExceeded.mock.calls };
    };

    const lean = guardCalls(
      (options) =>
        new LeanRegexSearchStrategy(new CorePartialMatchRegExp(/\S+/), options)
    );

    expect(lean.calls).not.toHaveLength(0);
    expect(lean).toEqual(
      guardCalls((options) => new RegexSearchStrategy(/\S+/, options))
    );
  });
});
