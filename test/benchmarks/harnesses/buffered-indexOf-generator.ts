import { generatorHarnessTransformer } from "./engine-harness.ts";
import type { ReplacementContext } from "../../../src/engines/types.ts";
import { BufferedIndexOfCanonicalAsGeneratorSearchStrategy } from "../references/engine-shapes/index.ts";

export const BufferedIndexOfGeneratorHarness = {
  name: "Buffered IndexOf Generator Canonical",
  isAsync: false,
  createSearchStrategy: ({ tokens }: { tokens: string[] }) => tokens,
  createTransformer: ({
    strategy: tokens,
    replacement
  }: {
    strategy: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    generatorHarnessTransformer(
      new BufferedIndexOfCanonicalAsGeneratorSearchStrategy(replacement, tokens)
    )
};
