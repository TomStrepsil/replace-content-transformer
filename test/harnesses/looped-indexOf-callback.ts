import { ReplaceContentTransformerCallback } from "../../src/adapters/web/benchmarking/sync-transformer-callback.ts";
import { LoopedIndexOfCallbackSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

export const LoopedIndexOfCallbackHarness = {
  name: "Looped IndexOf Callback",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens,
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) => {
    return new LoopedIndexOfCallbackSearchStrategy(replacement, tokens);
  },
  createTransformer: ({
    strategy
  }: {
    strategy: LoopedIndexOfCallbackSearchStrategy;
  }) => new ReplaceContentTransformerCallback(strategy)
};
