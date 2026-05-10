import { RegexSearchStrategy, SyncReplacementTransformEngine } from "../../src/index.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import type { ReplacementContext } from "../../src/engines/types.ts";

export const RegexHarness = {
  name: "Regex",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) =>
    new RegexSearchStrategy(
      new RegExp(tokens.map(RegExp.escape).join(".*?"), "s")
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: RegexSearchStrategy;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SyncReplacementTransformEngine({
        searchStrategy: strategy,
        replacement: (match, context) => replacement(match[0], context)
      })
    )
};
