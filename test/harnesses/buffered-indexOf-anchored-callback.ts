import { ReplaceContentTransformerCallback } from "../../src/adapters/web/benchmarking/sync-transformer-callback.ts";
import { BufferedIndexOfAnchoredCallbackSearchStrategy } from "../../src/search-strategies/benchmarking/buffered-indexOf-anchored-callback/search-strategy.ts";

export const BufferedIndexOfAnchoredCallbackHarness = {
  name: "Buffered IndexOf Anchored Callback",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens,
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, index: number) => string;
  }) => {
    return new BufferedIndexOfAnchoredCallbackSearchStrategy(
      replacement,
      tokens
    );
  },
  createTransformer: ({
    strategy
  }: {
    strategy: BufferedIndexOfAnchoredCallbackSearchStrategy;
  }) => new ReplaceContentTransformerCallback(strategy)
};
