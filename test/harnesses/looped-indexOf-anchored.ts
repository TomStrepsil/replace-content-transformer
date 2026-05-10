import { SyncReplacementTransformEngine } from "../../src/engines/sync-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import { LoopedIndexOfAnchoredSearchStrategy } from "../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";

export const LoopedIndexOfAnchoredHarness = {
  name: "Looped IndexOf Anchored",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) => {
    return new LoopedIndexOfAnchoredSearchStrategy(tokens);
  },
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: LoopedIndexOfAnchoredSearchStrategy;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement
      })
    )
};
