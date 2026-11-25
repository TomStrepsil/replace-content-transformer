import { SerialTransformEngine } from "../../../src/engines/serial-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import { RegexSearchStrategy } from "../../../src/search-strategies/regex/search-strategy.ts";
import { AnchorSequenceSearchStrategy } from "../references/algorithms/index.ts";
import type { ReplacementContext } from "../../../src/engines/types.ts";
import type { RegexSearchState, StreamRegexMatch } from "../../../src/search-strategies/regex/types.ts";

export const RegexAnchorSequenceHarness = {
  name: "Regex + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) =>
    new AnchorSequenceSearchStrategy<RegexSearchState, StreamRegexMatch>(
      tokens.map(
        (token) => new RegexSearchStrategy(new RegExp(RegExp.escape(token)))
      )
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<RegexSearchState, StreamRegexMatch>;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SerialTransformEngine({
        searchStrategy: strategy,
        replacement: (match, ctx) => replacement(match, ctx)
      })
    )
};
