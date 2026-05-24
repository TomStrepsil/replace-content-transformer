import { SyncReplacementTransformEngine } from "../../src/engines/sync-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import { BalancedPairSearchStrategy } from "../../src/search-strategies/balanced-pair/search-strategy.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";

export const BalancedPairHarness = {
  name: "Balanced Pair",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) => {
    return new BalancedPairSearchStrategy(tokens[0], tokens[1]);
  },
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: BalancedPairSearchStrategy;
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
