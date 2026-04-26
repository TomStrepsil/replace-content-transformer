import { FunctionReplacementProcessor } from "../../src/index.ts";
import { ReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";
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
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
