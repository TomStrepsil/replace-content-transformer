import { ReplaceContentTransformer } from "../../src/adapters/web/sync-transformer.ts";
import { FunctionReplacementProcessor } from "../../src/index.ts";
import { LoopedIndexOfAnchoredSearchStrategy } from "../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

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
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
