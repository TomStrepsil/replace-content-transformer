import { legacyHarnessTransformer } from "./engine-harness.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";
import { BufferedIndexOfReplaceContentTransformer } from "../../src/search-strategies/benchmarking/index.ts";

export const BufferedIndexOfCanonicalHarness = {
  name: "Buffered IndexOf Canonical",
  isAsync: false,
  createSearchStrategy: ({ tokens }: { tokens: string[] }) => tokens,
  createTransformer: ({
    strategy: tokens,
    replacement
  }: {
    strategy: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    legacyHarnessTransformer(
      new BufferedIndexOfReplaceContentTransformer(replacement, tokens)
    )
};
