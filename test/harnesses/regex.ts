import {
  createFunctionReplacementProcessor,
  createRegexSearchStrategy
} from "../../src/index.ts";
import { createReplaceContentTransformer } from "../../src/adapters/web/index.ts";
import type { SearchStrategy } from "../../src/search-strategies/types.ts";
import type { StringBufferState } from "../../src/search-strategies/string-buffer-strategy-base.ts";

export const RegexHarness = {
  name: "Regex",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, index: number) => string;
  }) =>
    createRegexSearchStrategy(
      new RegExp(tokens.map(RegExp.escape).join(".*?"), "s")
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: SearchStrategy<StringBufferState, RegExpExecArray>;
    replacement: (match: string, index: number) => string;
  }) =>
    createReplaceContentTransformer(
      createFunctionReplacementProcessor({
        searchStrategy: strategy,
        replacement: (match, index) => replacement(match[0], index)
      })
    )
};
