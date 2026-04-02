import { AsyncFunctionReplacementProcessor } from "../../src/replacement-processors/async-function-replacement-processor.ts";
import { AsyncReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import { BufferedIndexOfAnchoredSearchStrategy } from "../../src/search-strategies/benchmarking/buffered-indexOf-anchored/search-strategy.ts";

export const BufferedIndexOfAnchoredAsyncHarness = {
  name: "Buffered IndexOf Anchored (Async)",
  isAsync: true,
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
    replacement: (match: string, index: number) => Promise<string>;
  }) =>
    new AsyncReplaceContentTransformer(
      new AsyncFunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
