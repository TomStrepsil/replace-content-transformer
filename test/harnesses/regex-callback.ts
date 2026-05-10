import { callbackHarnessTransformer } from "./engine-harness.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";
import { RegexCallbackSearchStrategy } from "../../src/search-strategies/benchmarking/index.ts";

export const RegexCallbackHarness = {
  name: "Regex Callback",
  isAsync: false,
  createSearchStrategy: ({
    tokens: [startToken, endToken]
  }: {
    tokens: string[];
  }) => ({
    // contrived, to ensure one-time construction overhead of regexes
    needle: new RegExp(
      `${RegExp.escape(startToken)}.*?${RegExp.escape(endToken)}`,
      "gs"
    )
  }),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: { needle: RegExp };
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    callbackHarnessTransformer(
      new RegexCallbackSearchStrategy(replacement, strategy.needle)
    )
};
