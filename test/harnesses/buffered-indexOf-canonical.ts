import { BufferedIndexOfReplaceContentTransformer } from "../../src/search-strategies/benchmarking/index.ts";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

export const BufferedIndexOfCanonicalHarness = {
  name: "Buffered IndexOf Canonical",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens,
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) => {
    return { tokens, replacement };
  },
  createTransformer: ({
    strategy
  }: {
    strategy: {
      tokens: string[];
      replacement: (match: string, context: ReplacementContext) => string;
    };
  }) =>
    new BufferedIndexOfReplaceContentTransformer(
      strategy.replacement,
      strategy.tokens
    )
};
