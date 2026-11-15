import { syncHarnessTransformer } from "./engine-harness.ts";
import {
  GeneratorTransformEngine,
  LoopedIndexOfAnchoredGeneratorSearchStrategy
} from "../references/engine-shapes/index.ts";
import type { ReplacementContext } from "../../../src/engines/types.ts";

export const LoopedIndexOfAnchoredGeneratorHarness = {
  name: "Looped IndexOf Anchored (generator engine)",
  isAsync: false,
  createSearchStrategy: ({ tokens }: { tokens: string[] }) =>
    new LoopedIndexOfAnchoredGeneratorSearchStrategy(tokens),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: LoopedIndexOfAnchoredGeneratorSearchStrategy;
    replacement: (match: string, context: ReplacementContext) => string;
  }) => syncHarnessTransformer(new GeneratorTransformEngine(strategy, replacement))
};
