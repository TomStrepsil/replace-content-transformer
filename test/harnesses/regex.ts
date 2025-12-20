import {
  FunctionReplacementProcessor,
  RegexSearchStrategy
} from "../../src/index.ts";
import { ReplaceContentTransformer } from "../../src/adapters/web/index.ts";

export const RegexHarness = {
  name: "Regex",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) =>
    new RegexSearchStrategy(
      new RegExp(tokens.map(RegExp.escape).join(".*?"), "s")
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: RegexSearchStrategy;
    replacement: (match: string, index: number) => string;
  }) =>
    new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement
      })
    )
};
