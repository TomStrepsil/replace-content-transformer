import { AsyncSerialReplacementTransformEngine } from "../../../src/engines/async-serial-transform-engine.ts";
import { asyncHarnessTransformer } from "./engine-harness.ts";
import { LoopedIndexOfAnchoredSearchStrategy } from "../../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";
import type { ReplacementContext } from "../../../src/engines/types.ts";

export const LoopedIndexOfAnchoredAsyncHarness = {
  name: "Looped IndexOf Anchored (Async)",
  isAsync: true,
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
    replacement: (match: string, context: ReplacementContext) => Promise<string>;
  }) =>
    asyncHarnessTransformer(
      new AsyncSerialReplacementTransformEngine({
        searchStrategy: strategy,
        replacement
      })
    )
};
