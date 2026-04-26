import { ReplaceContentTransformerCallback } from "../../src/adapters/web/benchmarking/sync-transformer-callback.ts";
import { RegexCallbackSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

export const RegexCallbackHarness = {
  name: "Regex Callback",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens: [startToken, endToken],
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, context: ReplacementContext) => string;
  }) => {
    const needle = new RegExp(
      `${RegExp.escape(startToken)}.*?${RegExp.escape(endToken)}`,
      "gs"
    );
    return new RegexCallbackSearchStrategy(replacement, needle);
  },
  createTransformer: ({
    strategy
  }: {
    strategy: RegexCallbackSearchStrategy;
  }) => new ReplaceContentTransformerCallback(strategy)
};
