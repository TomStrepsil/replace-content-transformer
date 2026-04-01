import { createReplaceContentTransformer } from "../../src/adapters/web/sync-transformer.ts";
import { createFunctionReplacementProcessor } from "../../src/index.ts";
import { createLoopedIndexOfAnchoredSearchStrategy } from "../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";
import type { SearchStrategy } from "../../src/search-strategies/types.ts";
import type { LoopedIndexOfAnchoredSearchState } from "../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";

export const LoopedIndexOfAnchoredHarness = {
  name: "Looped IndexOf Anchored",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) => {
    return createLoopedIndexOfAnchoredSearchStrategy(tokens);
  },
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: SearchStrategy<LoopedIndexOfAnchoredSearchState>;
    replacement: (match: string, index: number) => string;
  }) =>
    createReplaceContentTransformer(
      createFunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
