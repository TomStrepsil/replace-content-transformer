import { BufferedIndexOfReplaceContentTransformer } from "../../src/search-strategies/benchmarking/index.ts";

export const BufferedIndexOfCanonicalHarness = {
  name: "Buffered IndexOf Canonical",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens,
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, index: number) => string;
  }) => {
    return { tokens, replacement };
  },
  createTransformer: ({
    strategy
  }: {
    strategy: {
      tokens: string[];
      replacement: (match: string, index: number) => string;
    };
  }) =>
    new BufferedIndexOfReplaceContentTransformer(
      strategy.replacement,
      strategy.tokens
    )
};
