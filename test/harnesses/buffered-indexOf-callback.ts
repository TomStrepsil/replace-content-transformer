import { callbackHarnessTransformer } from "./engine-harness.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";
import { BufferedIndexOfCallbackSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";

export const BufferedIndexOfCallbackHarness = {
  name: "Buffered IndexOf Callback",
  isAsync: false,
  createSearchStrategy: ({ tokens }: { tokens: string[] }) => tokens,
  createTransformer: ({
    strategy: tokens,
    replacement
  }: {
    strategy: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    callbackHarnessTransformer(
      new BufferedIndexOfCallbackSearchStrategy(replacement, tokens)
    )
};
