import { ReplaceContentTransformer } from "../../src/adapters/web/sync-transformer.ts";
import { FunctionReplacementProcessor } from "../../src/index.ts";
import { LoopedIndexOfAnchoredSearchStrategy } from "../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";

export const LoopedIndexOfAnchoredHarness = {
  name: "Looped IndexOf Anchored",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) => {
    return new LoopedIndexOfAnchoredSearchStrategy(tokens);
  },
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: LoopedIndexOfAnchoredSearchStrategy;
    replacement: (match: string, index: number) => string;
  }) =>
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
