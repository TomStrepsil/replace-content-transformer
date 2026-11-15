import { SerialTransformEngine } from "../../../src/engines/serial-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import { BufferedIndexOfAnchoredSearchStrategy } from "../references/algorithms/index.ts";
import type { ReplacementContext } from "../../../src/engines/types.ts";

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
    syncHarnessTransformer(
      new SerialTransformEngine({
        searchStrategy: strategy,
        replacement
      })
    )
};
