import { FunctionReplacementProcessor } from "../../src/index.ts";
import {
  RegexSearchStrategy,
  type RegexSearchState
} from "../../src/search-strategies/regex/search-strategy.ts";
import { AnchorSequenceSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";
import { ReplaceContentTransformer } from "../../src/adapters/web/index.ts";

export const RegexAnchorSequenceHarness = {
  name: "Regex + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) =>
    new AnchorSequenceSearchStrategy<RegexSearchState>(
      tokens.map(
        (token) => new RegexSearchStrategy(new RegExp(RegExp.escape(token)))
      )
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<RegexSearchState>;
    replacement: (match: string, index: number) => string;
  }) =>
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
