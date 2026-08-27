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

function nonMatch(content: string): MatchResult<RegExpExecArray> {
  return { isMatch: false, content };
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
  private readonly lookaheadConfirmationRegex: RegExp | null;

  constructor(needle: RegExp) {
    super();
    const partialMatchRegex = new PartialMatchRegExp(needle);
    validateInput(partialMatchRegex);
    this.completeMatchRegex = needle;
    this.partialMatchRegex = partialMatchRegex;
    const usesLookahead = partialMatchRegex.features.has("lookahead");
    this.lookaheadConfirmationRegex = usesLookahead
      ? new RegExp(needle.source, needle.flags + "y")
      : null;
  }

  private settledMatch(
    candidate: RegExpExecArray | null,
    haystack: string
  ): RegExpExecArray | null {
    if (candidate === null) return null;
    const matchLength = candidate[0].length;
    if (candidate.index + matchLength === haystack.length) return null;

    const confirmation = this.lookaheadConfirmationRegex;
    if (confirmation === null || matchLength === 0) return candidate;

    confirmation.lastIndex = candidate.index;
    const completeMatch = confirmation.exec(haystack);
    return completeMatch?.[0].length === matchLength ? candidate : null;
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
        const matchStart = partialMatch?.index ?? remainingHaystack.length;
        const settledMatch = this.settledMatch(partialMatch, remainingHaystack);

        if (settledMatch === null) {
          position = length;
          state.buffer = remainingHaystack.slice(matchStart);
          if (matchStart > 0)
            yield nonMatch(remainingHaystack.slice(0, matchStart));
          return;
        }

        state.buffer = "";
        const matchLength = settledMatch[0].length;

        const cannotAdvanceTheCursor = matchLength === 0;
        if (cannotAdvanceTheCursor) {
          const resumeAfterZeroLengthMatch = Math.min(
            position + matchStart + 1,
            length
          );
          const skipped = haystack.slice(position, resumeAfterZeroLengthMatch);
          position = resumeAfterZeroLengthMatch;
          yield nonMatch(skipped);
          continue;
        }

        if (matchStart > 0) {
          position += matchStart;
          yield nonMatch(remainingHaystack.slice(0, matchStart));
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

      if (finalMatch.index)
        yield nonMatch(remaining.slice(0, finalMatch.index));

      const matchStart = position + finalMatch.index;
      position = matchStart + finalMatch[0].length;

      yield toMatchResult(finalMatch, baseOffset + matchStart);
    }

    if (position < buffer.length) yield nonMatch(buffer.slice(position));
  }

  override matchToString(match: RegExpExecArray): string {
    return match[0];
  }
}
