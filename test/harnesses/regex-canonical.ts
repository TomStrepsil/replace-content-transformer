import { RegexReplaceContentTransformer } from "../../src/search-strategies/benchmarking/index.ts";
import createPartialMatchRegex from "regex-partial-match";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

export const RegexCanonicalHarness = {
  name: "Regex Canonical",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens,
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) => {
    // contrived, to ensure one-time construction overhead of regexes
    return {
      replacement,
      openRegex: new RegExp(
        `${RegExp.escape(tokens[0])}.*?${RegExp.escape(tokens[1])}`,
        "gs"
      ),
      partialAtEndRegex: createPartialMatchRegex(
        new RegExp(`${RegExp.escape(tokens[0])}.*?${RegExp.escape(tokens[1])}`)
      )
    };
  },
  createTransformer: ({
    strategy
  }: {
    strategy: {
      replacement: (match: string, context: ReplacementContext) => string;
      openRegex: RegExp;
      partialAtEndRegex: RegExp;
    };
  }) =>
    new RegexReplaceContentTransformer(
      strategy.replacement,
      strategy.openRegex,
      strategy.partialAtEndRegex
    )
};
