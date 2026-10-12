import { SyncReplacementTransformEngine } from "../../src/engines/sync-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import { RegexSearchStrategy } from "../../src/search-strategies/regex/search-strategy.ts";
import { AnchorSequenceSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";
import type { StringBufferState } from "../../src/search-strategies/types.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";
import type { StreamRegexMatch } from "../../src/search-strategies/regex/types.ts";

export const RegexAnchorSequenceHarness = {
  name: "Regex + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) =>
    new AnchorSequenceSearchStrategy<StringBufferState, StreamRegexMatch>(
      tokens.map(
        (token) => new RegexSearchStrategy(new RegExp(RegExp.escape(token)))
      )
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<StringBufferState, StreamRegexMatch>;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: (match, ctx) => replacement(match, ctx)
      })
    )
};
