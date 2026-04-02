import { FunctionReplacementProcessor } from "../../src/replacement-processors/function-replacement-processor.ts";
import { ReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import {
  AnchorSequenceSearchStrategy,
  BufferedIndexOfCancellableSearchStrategy,
  type BufferedIndexOfCancellableSearchState
} from "../../src/search-strategies/benchmarking/index.ts";

export const BufferedIndexOfAnchorSequenceHarness = {
  name: "Buffered IndexOf + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) =>
    new AnchorSequenceSearchStrategy<BufferedIndexOfCancellableSearchState>(
      tokens.map((token) => new BufferedIndexOfCancellableSearchStrategy(token))
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<BufferedIndexOfCancellableSearchState>;
    replacement: (match: string, index: number) => string;
  }) =>
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
