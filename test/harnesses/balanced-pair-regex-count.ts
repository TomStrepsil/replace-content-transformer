import { SyncReplacementTransformEngine } from "../../src/engines/sync-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import { BalancedPairRegexCountSearchStrategy } from "../../src/search-strategies/benchmarking/balanced-pair-regex-count/search-strategy.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";

export const BalancedPairRegexCountHarness = {
  name: "Balanced Pair (regex count)",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) => {
    return new BalancedPairRegexCountSearchStrategy(tokens[0], tokens[1]);
  },
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: BalancedPairRegexCountSearchStrategy;
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
