import { createFunctionReplacementProcessor } from "../../src/index.ts";
import { createReplaceContentTransformer } from "../../src/adapters/web/index.ts";
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
    replacement?: (match: string, index: number) => string;
  }) =>
    new AnchorSequenceSearchStrategy<LoopedIndexOfCancellableSearchState>(
      tokens.map((token) => new LoopedIndexOfCancellableSearchStrategy(token))
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<LoopedIndexOfCancellableSearchState>;
    replacement: (match: string, index: number) => string;
  }) =>
    createReplaceContentTransformer(
      createFunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
