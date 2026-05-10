import { legacyHarnessTransformer } from "./engine-harness.ts";
import createPartialMatchRegex from "regex-partial-match";
import type { ReplacementContext } from "../../src/engines/types.ts";
import { RegexReplaceContentTransformer } from "../../src/search-strategies/benchmarking/index.ts";

export const RegexCanonicalHarness = {
  name: "Regex Canonical",
  isAsync: false,
  createSearchStrategy: ({ tokens }: { tokens: string[] }) => ({
    // contrived, to ensure one-time construction overhead of regexes
    openRegex: new RegExp(
      `${RegExp.escape(tokens[0])}.*?${RegExp.escape(tokens[1])}`,
      "gs"
    ),
    partialAtEndRegex: createPartialMatchRegex(
      new RegExp(`${RegExp.escape(tokens[0])}.*?${RegExp.escape(tokens[1])}`)
    )
  }),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: { openRegex: RegExp; partialAtEndRegex: RegExp };
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    legacyHarnessTransformer(
      new RegexReplaceContentTransformer(
        replacement,
        strategy.openRegex,
        strategy.partialAtEndRegex
      )
    )
};
