import type { MatchResult, SearchStrategy } from "../types.ts";
import createPartialMatchRegex from "regex-partial-match";
import validateInput from "./input-validation.ts";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../string-buffer-strategy-base.ts";


/**
 * A search strategy for finding patterns using regular expressions.
 *
 * This strategy enables powerful pattern matching using JavaScript RegExp, supporting
 * most standard regex features (capture groups, lookaheads, character classes, etc.).
 * It correctly handles matches that span chunk boundaries by maintaining a buffer and
 * using partial match detection to avoid splitting incomplete patterns.
 *
 * @example Basic regex search
 * ```typescript
 * import { searchStrategyFactory, FunctionReplacementProcessor } from 'replace-content-transformer';
 *
 * // Factory automatically creates RegexSearchStrategy for RegExp input
 * const strategy = searchStrategyFactory(/\{\{(\w+)\}\}/);
 *
 * const processor = new FunctionReplacementProcessor({
 *   searchStrategy: strategy,
 *   replacement: (match) => {
 *     return `Value: ${match[1]}`;
 *   }
 * });
 * ```
 */

export class RegexSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<StringBufferState, RegExpExecArray>
{
  private readonly completeMatchRegex: RegExp;
  private readonly partialMatchRegex: RegExp;

  constructor(needle: RegExp) {
    super();
    validateInput(needle);
    this.completeMatchRegex = needle;
    this.partialMatchRegex = createPartialMatchRegex(needle);
  }

  *processChunk(
    haystack: string,
    state: StringBufferState
  ): Generator<MatchResult<RegExpExecArray>, void, undefined> {
    haystack = state.buffer + haystack;
    const length = haystack.length;
    let position = 0;
    try {
      while (position < length) {
        const remainingHaystack = haystack.substring(position);
        const completeMatch = this.completeMatchRegex.exec(remainingHaystack);
        if (!completeMatch) {
          position = length;
          const partialMatch = this.partialMatchRegex.exec(remainingHaystack)!;
          if (partialMatch?.[0]) {
            state.buffer = remainingHaystack.slice(partialMatch.index);
            if (partialMatch.index > 0) {
              yield {
                isMatch: false,
                content: remainingHaystack.slice(0, partialMatch.index)
              };
            }
          } else {
            state.buffer = "";
            yield { isMatch: false, content: remainingHaystack };
          }
          return;
        }

        state.buffer = "";
        if (completeMatch.index) {
          const matchStart = position + completeMatch.index;
          const nonMatch = haystack.slice(position, matchStart);
          position = matchStart;
          yield { isMatch: false, content: nonMatch };
        }

        position += completeMatch[0].length;
        yield { isMatch: true, content: completeMatch };
      }
    } finally {
      if (position < length) {
        state.buffer += haystack.slice(position);
      }
    }
  }
}
