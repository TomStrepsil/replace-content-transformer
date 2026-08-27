import type { MatchResult, SearchStrategy } from "../types.js";
import PartialMatchRegExp from "regex-partial-match";
import validateInput from "./input-validation.js";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../string-buffer-strategy-base.js";

function updateIndices(indices: RegExpIndicesArray, offset: number) {
  for (const entry of indices) {
    if (entry === undefined) continue;
    entry[0] += offset;
    entry[1] += offset;
  }
}

function toMatchResult(
  match: RegExpExecArray,
  startIndex: number
): MatchResult<RegExpExecArray> {
  const indices = match.indices;
  if (indices) updateIndices(indices, startIndex - match.index);
  return {
    isMatch: true,
    content: match,
    streamIndices: [startIndex, startIndex + match[0].length]
  };
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
  implements SearchStrategy<StringBufferState, RegExpExecArray>
{
  private readonly completeMatchRegex: RegExp;
  private readonly partialMatchRegex: RegExp;
  private readonly lookaheadMayBeTruncated: boolean;
  private readonly anchoredCompleteMatchRegex: RegExp;

  constructor(needle: RegExp) {
    super();
    const partialMatchRegex = new PartialMatchRegExp(needle);
    validateInput(partialMatchRegex);
    this.completeMatchRegex = needle;
    this.partialMatchRegex = partialMatchRegex;
    this.lookaheadMayBeTruncated = partialMatchRegex.features.has("lookahead");
    this.anchoredCompleteMatchRegex = new RegExp(
      needle.source,
      needle.flags + "y"
    );
  }

  private isCompleteMatch(candidate: RegExpExecArray, haystack: string) {
    const anchoredAtCandidate = this.anchoredCompleteMatchRegex;
    anchoredAtCandidate.lastIndex = candidate.index;
    const completeMatch = anchoredAtCandidate.exec(haystack);
    return (
      completeMatch !== null && completeMatch[0].length === candidate[0].length
    );
  }

  *processChunk(
    haystack: string,
    state: StringBufferState
  ): Generator<MatchResult<RegExpExecArray>, void, undefined> {
    const bufferLength = state.buffer.length;
    const baseOffset = state.streamOffset - bufferLength;
    haystack = state.buffer + haystack;
    const length = haystack.length;
    let position = 0;
    try {
      while (position < length) {
        const remainingHaystack = haystack.substring(position);
        const partialMatch = this.partialMatchRegex.exec(remainingHaystack);
        const matchLength = partialMatch === null ? 0 : partialMatch[0].length;
        const endsAtEndOfHaystack =
          partialMatch !== null &&
          partialMatch.index + matchLength === remainingHaystack.length;

        const lookaheadOutrunsTheMatch =
          this.lookaheadMayBeTruncated &&
          partialMatch !== null &&
          !endsAtEndOfHaystack &&
          matchLength > 0 &&
          !this.isCompleteMatch(partialMatch, remainingHaystack);

        const chunkIsSpent =
          partialMatch === null ||
          endsAtEndOfHaystack ||
          lookaheadOutrunsTheMatch;
        if (chunkIsSpent) {
          const couldStillBeGrowing = partialMatch !== null && matchLength > 0;
          const bufferFrom = couldStillBeGrowing
            ? partialMatch.index
            : remainingHaystack.length;
          position = length;
          state.buffer = remainingHaystack.slice(bufferFrom);
          if (bufferFrom > 0) {
            yield {
              isMatch: false,
              content: remainingHaystack.slice(0, bufferFrom)
            };
          }
          return;
        }

        const cannotAdvanceTheCursor = matchLength === 0;
        if (cannotAdvanceTheCursor) {
          state.buffer = "";
          const resumeAfterSkippingZeroLengthMatch = Math.min(
            position + partialMatch.index + 1,
            length
          );
          const skipped = haystack.slice(
            position,
            resumeAfterSkippingZeroLengthMatch
          );
          position = resumeAfterSkippingZeroLengthMatch;
          yield { isMatch: false, content: skipped };
          continue;
        }

        const settledMatch = partialMatch;
        state.buffer = "";
        if (settledMatch.index) {
          const matchStart = position + settledMatch.index;
          const nonMatch = haystack.slice(position, matchStart);
          position = matchStart;
          yield { isMatch: false, content: nonMatch };
        }

        const startIndex = baseOffset + position;
        position += matchLength;

        yield toMatchResult(settledMatch, startIndex);
      }
    } finally {
      if (position < length) {
        state.buffer += haystack.slice(position);
      }
      state.streamOffset += haystack.length - bufferLength;
    }
  }

  *flush(
    state: StringBufferState
  ): Generator<MatchResult<RegExpExecArray>, void, undefined> {
    const buffer = state.buffer;
    const baseOffset = state.streamOffset - buffer.length;
    state.buffer = "";
    state.streamOffset = 0;

    let position = 0;
    while (position < buffer.length) {
      const remaining = buffer.substring(position);
      const finalMatch = this.completeMatchRegex.exec(remaining);
      if (!finalMatch?.[0]) break;

      if (finalMatch.index) {
        yield { isMatch: false, content: remaining.slice(0, finalMatch.index) };
      }

      const matchStart = position + finalMatch.index;
      position = matchStart + finalMatch[0].length;

      yield toMatchResult(finalMatch, baseOffset + matchStart);
    }

    if (position < buffer.length) {
      yield { isMatch: false, content: buffer.slice(position) };
    }
  }

  override matchToString(match: RegExpExecArray): string {
    return match[0];
  }
}
