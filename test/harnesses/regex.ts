import {
  FunctionReplacementProcessor,
  RegexSearchStrategy
} from "../../src/index.ts";
import { ReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

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
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement: (match, context) => replacement(match[0], context)
      })
    )
};
