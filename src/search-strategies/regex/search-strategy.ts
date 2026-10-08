import type { MatchResult, SearchStrategy } from "../types.js";
import PartialMatchRegExp, { features, hitEnd } from "regex-partial-match";
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

function sameCaptures(
  candidate: RegExpExecArray,
  confirmed: RegExpExecArray
): boolean {
  return (
    candidate.length === confirmed.length &&
    candidate.every((capture, group) => capture === confirmed[group])
  );
}

const FEATURES_NEEDING_PROBE_BEFORE_END = [
  "backreference",
  "namedBackreference",
  "lookahead"
] as const;

function endsAtHaystackEnd(
  match: RegExpExecArray,
  haystack: string
): boolean {
  return match.index + match[0].length === haystack.length;
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

type ScanCursor = { reportedUpTo: number };

function skipOneCodeUnitPastZeroLengthMatch(
  haystack: string,
  cursor: ScanCursor,
  matchIndex: number
): MatchResult<RegExpExecArray> {
  const skippedFrom = cursor.reportedUpTo;
  cursor.reportedUpTo = Math.min(skippedFrom + matchIndex + 1, haystack.length);
  return nonMatch(haystack.slice(skippedFrom, cursor.reportedUpTo));
}

function advanceToMatch(
  match: RegExpExecArray,
  haystack: string,
  cursor: ScanCursor
): MatchResult<RegExpExecArray> | null {
  const precedingContentFrom = cursor.reportedUpTo;
  cursor.reportedUpTo = precedingContentFrom + match.index;
  return match.index > 0
    ? nonMatch(haystack.slice(precedingContentFrom, cursor.reportedUpTo))
    : null;
}

function takeMatch(
  match: RegExpExecArray,
  cursor: ScanCursor,
  baseOffset: number
): MatchResult<RegExpExecArray> {
  const matchStart = cursor.reportedUpTo;
  cursor.reportedUpTo = matchStart + match[0].length;
  return toMatchResult(match, baseOffset + matchStart);
}

/**
 * A search strategy for finding patterns using regular expressions.
 *
 * This strategy enables powerful pattern matching using JavaScript RegExp, supporting
 * most standard regex features (capture groups, positive lookaheads, character classes, etc.).
 * It correctly handles matches that span chunk boundaries by maintaining a buffer and
 * using partial match detection to avoid splitting incomplete patterns.
 *
 * @throws If `needle` uses a construct whose truth a streaming scan cannot decide
 * at a chunk boundary — negative lookaheads, lookbehinds, word boundaries, the
 * `^`/`$` anchors — or the `g`, `y` or `m` flags. See [Limitations](./README.md#limitations).
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
  private readonly partialMatchRegex: PartialMatchRegExp;
  private readonly lookaheadConfirmationRegex: RegExp | null;
  private readonly probesCandidatesEndingBeforeHaystackEnd: boolean;

  constructor(needle: RegExp) {
    super();
    const partialMatchRegex = new PartialMatchRegExp(needle);
    validateInput(partialMatchRegex);
    this.completeMatchRegex = needle;
    this.partialMatchRegex = partialMatchRegex;
    const patternFeatures = features(partialMatchRegex);
    this.probesCandidatesEndingBeforeHaystackEnd =
      FEATURES_NEEDING_PROBE_BEFORE_END.some((feature) =>
        patternFeatures.has(feature)
      );
    this.lookaheadConfirmationRegex = patternFeatures.has("lookahead")
      ? new RegExp(needle.source, `${needle.flags}y`)
      : null;
  }

  private settledMatch(
    candidate: RegExpExecArray | null,
    haystack: string
  ): RegExpExecArray | null {
    if (candidate === null) return null;
    if (endsAtHaystackEnd(candidate, haystack)) return null;
    if (!this.probesCandidatesEndingBeforeHaystackEnd) return candidate;
    if (hitEnd(this.partialMatchRegex, candidate)) return null;

    const confirmation = this.lookaheadConfirmationRegex;
    if (confirmation === null) return candidate;

    confirmation.lastIndex = candidate.index;
    const completeMatch = confirmation.exec(haystack);
    if (completeMatch === null) return null;
    return sameCaptures(candidate, completeMatch) ? completeMatch : null;
  }

  *processChunk(
    haystack: string,
    state: StringBufferState
  ): Generator<MatchResult<RegExpExecArray>, void, undefined> {
    const bufferLength = state.buffer.length;
    const baseOffset = state.streamOffset - bufferLength;
    haystack = state.buffer + haystack;
    const length = haystack.length;
    const cursor: ScanCursor = { reportedUpTo: 0 };
    try {
      while (cursor.reportedUpTo < length) {
        const remainingHaystack = haystack.substring(cursor.reportedUpTo);
        const partialMatch = this.partialMatchRegex.exec(remainingHaystack);
        const matchStart = partialMatch?.index ?? remainingHaystack.length;
        const settledMatch = this.settledMatch(partialMatch, remainingHaystack);

        if (settledMatch === null) {
          cursor.reportedUpTo = length;
          state.buffer = remainingHaystack.slice(matchStart);
          if (matchStart > 0)
            yield nonMatch(remainingHaystack.slice(0, matchStart));
          return;
        }

        state.buffer = "";
        if (settledMatch[0].length === 0) {
          yield skipOneCodeUnitPastZeroLengthMatch(
            haystack,
            cursor,
            settledMatch.index
          );
          continue;
        }
        const precedingContent = advanceToMatch(settledMatch, haystack, cursor);
        if (precedingContent) yield precedingContent;
        yield takeMatch(settledMatch, cursor, baseOffset);
      }
    } finally {
      if (cursor.reportedUpTo < length) {
        state.buffer += haystack.slice(cursor.reportedUpTo);
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

    const cursor: ScanCursor = { reportedUpTo: 0 };
    while (cursor.reportedUpTo < buffer.length) {
      const finalMatch = this.completeMatchRegex.exec(
        buffer.substring(cursor.reportedUpTo)
      );
      if (finalMatch === null) break;

      if (finalMatch[0].length === 0) {
        yield skipOneCodeUnitPastZeroLengthMatch(
          buffer,
          cursor,
          finalMatch.index
        );
        continue;
      }
      const precedingContent = advanceToMatch(finalMatch, buffer, cursor);
      if (precedingContent) yield precedingContent;
      yield takeMatch(finalMatch, cursor, baseOffset);
    }

    if (cursor.reportedUpTo < buffer.length) {
      yield nonMatch(buffer.slice(cursor.reportedUpTo));
    }
  }

  override matchToString(match: RegExpExecArray): string {
    return match[0];
  }
}
