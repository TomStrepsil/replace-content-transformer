import { FunctionReplacementProcessor } from "../../src/index.ts";
import { ReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import {
  AnchorSequenceSearchStrategy,
  IndexOfKnuthMorrisPrattSearchStrategy,
  type IndexOfKnuthMorrisPrattSearchState
} from "../../src/search-strategies/benchmarking/index.ts";

export const KMPAnchorSequenceHarness = {
  name: "KMP + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) =>
    new AnchorSequenceSearchStrategy<IndexOfKnuthMorrisPrattSearchState>(
      tokens.map((token) => new IndexOfKnuthMorrisPrattSearchStrategy(token))
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<IndexOfKnuthMorrisPrattSearchState>;
    replacement: (match: string, index: number) => string;
  }) =>
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
