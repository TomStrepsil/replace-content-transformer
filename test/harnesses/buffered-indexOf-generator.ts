import { ReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import { BufferedIndexOfCanonicalAsGeneratorSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

export const BufferedIndexOfGeneratorHarness = {
  name: "Buffered IndexOf Generator Canonical",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens,
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) => {
    return new BufferedIndexOfCanonicalAsGeneratorSearchStrategy(
      replacement,
      tokens
    );
  },
  createTransformer: ({
    strategy
  }: {
    strategy: BufferedIndexOfCanonicalAsGeneratorSearchStrategy;
  }) => new ReplaceContentTransformer(strategy)
};
