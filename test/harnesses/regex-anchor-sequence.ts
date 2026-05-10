import { SyncReplacementTransformEngine } from "../../src/engines/sync-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import { RegexSearchStrategy } from "../../src/search-strategies/regex/search-strategy.ts";
import { AnchorSequenceSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";
import type { StringBufferState } from "../../src/search-strategies/string-buffer-strategy-base.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";

export const RegexAnchorSequenceHarness = {
  name: "Regex + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) =>
    new AnchorSequenceSearchStrategy<StringBufferState, RegExpExecArray>(
      tokens.map(
        (token) => new RegexSearchStrategy(new RegExp(RegExp.escape(token)))
      )
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<StringBufferState, RegExpExecArray>;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: (match, ctx) => replacement(match, ctx)
      })
    )
};
