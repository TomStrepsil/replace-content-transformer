import type { MatchResult, SearchStrategy } from "../types.ts";
import createPartialMatchRegex from "regex-partial-match";
import validateInput from "./input-validation.ts";
import StringBufferStrategyBase, {
  type StringBufferState,
  createStringBufferState,
  flushStringBuffer
} from "../string-buffer-strategy-base.ts";


/**
 * Creates a search strategy for finding patterns using regular expressions.
 *
 * This strategy enables powerful pattern matching using JavaScript RegExp, supporting
 * most standard regex features (capture groups, lookaheads, character classes, etc.).
 * It correctly handles matches that span chunk boundaries by maintaining a buffer and
 * using partial match detection to avoid splitting incomplete patterns.
 *
 * @example Basic regex search
 * ```typescript
 * import { createSearchStrategy, createFunctionReplacementProcessor } from 'replace-content-transformer';
 *
 * // Factory automatically creates a regex search strategy for RegExp input
 * const strategy = createSearchStrategy(/\{\{(\w+)\}\}/);
 *
 * const processor = createFunctionReplacementProcessor({
 *   searchStrategy: strategy,
 *   replacement: (match) => {
 *     return `Value: ${match[1]}`;
 *   }
 * });
 * ```
 */
export function createRegexSearchStrategy(
  needle: RegExp
): SearchStrategy<StringBufferState, RegExpExecArray> {
  validateInput(needle);
  const completeMatchRegex = needle;
  const partialMatchRegex = createPartialMatchRegex(needle);

  return {
    createState: createStringBufferState,

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
          const completeMatch = completeMatchRegex.exec(remainingHaystack);
          if (!completeMatch) {
            position = length;
            const partialMatch = partialMatchRegex.exec(remainingHaystack)!;
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
    },

    flush: flushStringBuffer
  };
}

/**
 * @deprecated Use {@link createRegexSearchStrategy} instead.
 */
export class RegexSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<StringBufferState, RegExpExecArray>
{
  #strategy: SearchStrategy<StringBufferState, RegExpExecArray>;

  constructor(needle: RegExp) {
    super();
    this.#strategy = createRegexSearchStrategy(needle);
  }

  *processChunk(
    haystack: string,
    state: StringBufferState
  ): Generator<MatchResult<RegExpExecArray>, void, undefined> {
    yield* this.#strategy.processChunk(haystack, state);
  }
}
