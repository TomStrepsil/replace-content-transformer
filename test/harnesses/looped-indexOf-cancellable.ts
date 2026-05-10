import { SyncReplacementTransformEngine } from "../../src/engines/sync-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";
import {
  AnchorSequenceSearchStrategy,
  LoopedIndexOfCancellableSearchStrategy,
  type LoopedIndexOfCancellableSearchState
} from "../../src/search-strategies/benchmarking/index.ts";

export const LoopedIndexOfAnchorSequenceHarness = {
  name: "Looped IndexOf + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) =>
    new AnchorSequenceSearchStrategy<LoopedIndexOfCancellableSearchState>(
      tokens.map((token) => new LoopedIndexOfCancellableSearchStrategy(token))
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<LoopedIndexOfCancellableSearchState>;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement
      })
    )
};
