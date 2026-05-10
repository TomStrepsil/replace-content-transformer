import { AsyncSerialReplacementTransformEngine } from "../../src/engines/async-serial-transform-engine.ts";
import { asyncHarnessTransformer } from "./engine-harness.ts";
import { BufferedIndexOfAnchoredSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";

export const BufferedIndexOfAnchoredAsyncHarness = {
  name: "Buffered IndexOf Anchored (Async)",
  isAsync: true,
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
    replacement: (match: string, context: ReplacementContext) => Promise<string>;
  }) =>
    asyncHarnessTransformer(
      new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement
      })
    )
};
