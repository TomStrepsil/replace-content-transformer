import { ReplaceContentTransformer } from "../../src/adapters/web/sync-transformer.ts";
import { FunctionReplacementProcessor } from "../../src/index.ts";
import { BufferedIndexOfAnchoredSearchStrategy } from "../../src/search-strategies/benchmarking/buffered-indexOf-anchored/search-strategy.ts";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

export const BufferedIndexOfAnchoredHarness = {
  name: "Buffered IndexOf Anchored",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) => {
    return new BufferedIndexOfAnchoredSearchStrategy(tokens);
  },
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: BufferedIndexOfAnchoredSearchStrategy;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
