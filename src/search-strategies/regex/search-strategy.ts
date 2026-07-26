import type { MatchResult, SearchStrategy } from "../types.js";
import PartialMatchRegExp from "regex-partial-match";
import validateInput from "./input-validation.js";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../string-buffer-strategy-base.js";

export type RegexSearchState = StringBufferState & {
  /**
   * The last UTF-16 code unit actually emitted so far — as match or
   * non-match content — or `undefined` if nothing has been emitted yet
   * (i.e. we are still at the true start of the stream). This is the one
   * piece of context `^` (no `m`), `\b`, and `^` under `/m` ever need to
   * look back past a chunk boundary: each only classifies its context as
   * word/non-word or line-terminator/not, and surrogate code units are
   * never either, so a lone trailing surrogate half classifies identically
   * to its full pair — no need to reassemble one here.
   */
  precedingChar: string | undefined;
};

function updateIndices(indices: RegExpIndicesArray, offset: number) {
  for (const entry of indices) {
    if (entry === undefined) continue;
    entry[0] += offset;
    entry[1] += offset;
  }
}

/**
 * A search strategy for finding patterns using regular expressions.
 *
 * This strategy enables powerful pattern matching using JavaScript RegExp, supporting
 * most standard regex features (capture groups, positive lookaheads, character classes, etc.).
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
  extends StringBufferStrategyBase<RegExpExecArray>
  implements SearchStrategy<RegexSearchState, RegExpExecArray>
{
  private readonly completeMatchRegex: RegExp;
  private readonly stickyMatchRegex: RegExp;
  private readonly partialMatchRegex: RegExp;
  /**
   * Whether `needle` can even invoke `^` (no `m`), `\b`, or `\B` — the only
   * assertions vulnerable to the chunk-boundary illusion `findCompleteMatch`
   * guards against. `^`, `\b`, and `\B` always appear literally in `.source`
   * when used as real assertions, so this substring check never misses a
   * pattern that needs the guard; it can only be a false positive (e.g. a
   * literal `^` inside a character class), which just costs an unneeded
   * check on patterns that never depended on this fix in the first place —
   * measured via benchmark to matter for match-dense content.
   */
  private readonly mayHaveBoundaryAssertion: boolean;

  constructor(needle: RegExp) {
    super();
    validateInput(needle);
    this.completeMatchRegex = needle;
    this.stickyMatchRegex = new RegExp(needle.source, needle.flags + "y");
    this.partialMatchRegex = new PartialMatchRegExp(needle);
    this.mayHaveBoundaryAssertion =
      needle.source.includes("^") ||
      needle.source.includes("\\b") ||
      needle.source.includes("\\B");
  }

  override createState(): RegexSearchState {
    return { ...super.createState(), precedingChar: undefined };
  }

  /**
   * Finds the leftmost complete match at or after `searchFrom`, rejecting any
   * candidate whose success at position 0 of its own exec'd slice depends on
   * `^`/`\b`/`^` (`/m`) treating a truncated slice's edge as the true stream
   * edge. Rejected candidates are re-verified against real preceding context
   * (one code unit, taken from `haystack` itself past `searchFrom`, or from
   * `statePrecedingChar` at `searchFrom` itself) using a sticky clone of the
   * pattern — which, forced to start exactly past that context, can't be
   * fooled into matching earlier by consuming the context character.
   */
  private findCompleteMatch(
    haystack: string,
    searchFrom: number,
    statePrecedingChar: string | undefined
  ): { match: RegExpExecArray; matchStart: number } | null {
    if (!this.mayHaveBoundaryAssertion) {
      const match = this.completeMatchRegex.exec(
        haystack.substring(searchFrom)
      );
      return match ? { match, matchStart: searchFrom + match.index } : null;
    }

    let pos = searchFrom;
    while (pos <= haystack.length) {
      const slice = haystack.substring(pos);
      const match = this.completeMatchRegex.exec(slice);
      if (!match) return null;
      const matchStart = pos + match.index;

      if (match.index === 0) {
        const contextChar =
          matchStart === 0 ? statePrecedingChar : haystack[matchStart - 1];

        if (contextChar !== undefined) {
          this.stickyMatchRegex.lastIndex = contextChar.length;
          const verified = this.stickyMatchRegex.exec(contextChar + slice);
          if (!verified) {
            pos = matchStart + (haystack.codePointAt(matchStart)! > 0xffff ? 2 : 1);
            continue;
          }
        }
      }

      return { match, matchStart };
    }
    return null;
  }

  *processChunk(
    haystack: string,
    state: RegexSearchState
  ): Generator<MatchResult<RegExpExecArray>, void, undefined> {
    const bufferLength = state.buffer.length;
    const baseOffset = state.streamOffset - bufferLength;
    haystack = state.buffer + haystack;
    const length = haystack.length;
    let position = 0;
    try {
      while (position < length) {
        const remainingHaystack = haystack.substring(position);
        const found = this.findCompleteMatch(
          haystack,
          position,
          state.precedingChar
        );
        if (!found) {
          position = length;
          const partialMatch = this.partialMatchRegex.exec(remainingHaystack);
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

        const { match: completeMatch, matchStart } = found;
        state.buffer = "";
        if (matchStart > position) {
          const nonMatch = haystack.slice(position, matchStart);
          position = matchStart;
          yield { isMatch: false, content: nonMatch };
        }

        const matchLength = completeMatch[0].length;
        const startIndex = baseOffset + position;
        const endIndex = startIndex + matchLength;
        position += matchLength;

        if (completeMatch.indices) {
          const indices = completeMatch.indices;
          const offset = startIndex - completeMatch.index;
          updateIndices(indices, offset);
          if (indices.groups) {
            updateIndices(Object.values(indices.groups), offset);
          }
        }

        yield {
          isMatch: true,
          content: completeMatch,
          streamIndices: [startIndex, endIndex]
        };
      }
    } finally {
      if (position < length) {
        state.buffer += haystack.slice(position);
      }
      state.streamOffset += haystack.length - bufferLength;

      const emittedLength = haystack.length - state.buffer.length;
      if (emittedLength > 0) {
        state.precedingChar = haystack[emittedLength - 1];
      }
    }
  }

  override flush(state: RegexSearchState): string {
    state.precedingChar = undefined;
    return super.flush(state);
  }

  override matchToString(match: RegExpExecArray): string {
    return match[0];
  }
}
