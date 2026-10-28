import { SyncReplacementTransformEngine } from "../../src/engines/sync-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import { BalancedPairRegexSearchStrategy } from "../../src/search-strategies/benchmarking/balanced-pair-regex-search/search-strategy.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";

export const BalancedPairRegexSearchHarness = {
  name: "Balanced Pair (regex search)",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) => {
    return new BalancedPairRegexSearchStrategy(tokens[0], tokens[1]);
  },
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: BalancedPairRegexSearchStrategy;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement
      })
    ),
  skipScenario: ({ balanced }: { balanced?: boolean }) => balanced === false
};
