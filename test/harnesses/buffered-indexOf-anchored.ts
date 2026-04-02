import { ReplaceContentTransformer } from "../../src/adapters/web/sync-transformer.ts";
import { FunctionReplacementProcessor } from "../../src/index.ts";
import { BufferedIndexOfAnchoredSearchStrategy } from "../../src/search-strategies/benchmarking/buffered-indexOf-anchored/search-strategy.ts";

export const BufferedIndexOfAnchoredHarness = {
  name: "Buffered IndexOf Anchored",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) => {
    return new BufferedIndexOfAnchoredSearchStrategy(tokens);
  },
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: BufferedIndexOfAnchoredSearchStrategy;
    replacement: (match: string, index: number) => string;
  }) =>
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
