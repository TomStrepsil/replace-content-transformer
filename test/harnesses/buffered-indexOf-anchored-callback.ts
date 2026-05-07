import { syncHarnessTransformer, callbackProcessorToEngine } from "./engine-harness.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";
import { BufferedIndexOfAnchoredCallbackSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts"

export const BufferedIndexOfAnchoredCallbackHarness = {
  name: "Buffered IndexOf Anchored Callback",
  isAsync: false,
  createSearchStrategy: ({ tokens }: { tokens: string[] }) => tokens,
  createTransformer: ({
    strategy: tokens,
    replacement
  }: {
    strategy: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      callbackProcessorToEngine(
        new BufferedIndexOfAnchoredCallbackSearchStrategy(replacement, tokens)
      )
    )
};
