import { ReplaceContentTransformerCallback } from "../../src/adapters/web/benchmarking/sync-transformer-callback.ts";
import { RegexCallbackSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";

export const RegexCallbackHarness = {
  name: "Regex Callback",
  isAsync: false,
  isStateful: true,
  createSearchStrategy: ({
    tokens: [startToken, endToken],
    replacement
  }: {
    tokens: string[];
    replacement: (match: string, index: number) => string;
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
