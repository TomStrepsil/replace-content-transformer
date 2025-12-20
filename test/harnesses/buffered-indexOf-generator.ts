import { ReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import { BufferedIndexOfCanonicalAsGeneratorSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";

export const BufferedIndexOfGeneratorHarness = {
  name: "Buffered IndexOf Generator Canonical",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens,
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, index: number) => string;
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
