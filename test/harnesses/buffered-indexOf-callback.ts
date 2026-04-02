import { ReplaceContentTransformerCallback } from "../../src/adapters/web/benchmarking/sync-transformer-callback.ts";
import { BufferedIndexOfCallbackSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";

export const BufferedIndexOfCallbackHarness = {
  name: "Buffered IndexOf Callback",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens,
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, index: number) => string;
  }) => {
    return new BufferedIndexOfCallbackSearchStrategy(replacement, tokens);
  },
  createTransformer: ({
    strategy
  }: {
    strategy: BufferedIndexOfCallbackSearchStrategy;
  }) => new ReplaceContentTransformerCallback(strategy)
};
