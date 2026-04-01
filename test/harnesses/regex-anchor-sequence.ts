import { createFunctionReplacementProcessor } from "../../src/index.ts";
import { createRegexSearchStrategy } from "../../src/search-strategies/regex/search-strategy.ts";
import { AnchorSequenceSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";
import { createReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import type { StringBufferState } from "../../src/search-strategies/string-buffer-strategy-base.ts";

export const RegexAnchorSequenceHarness = {
  name: "Regex + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) =>
    new AnchorSequenceSearchStrategy<StringBufferState, RegExpExecArray>(
      tokens.map(
        (token) => createRegexSearchStrategy(new RegExp(RegExp.escape(token)))
      )
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<StringBufferState, RegExpExecArray>;
    replacement: (match: string, index: number) => string;
  }) =>
    createReplaceContentTransformer(
      createFunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
