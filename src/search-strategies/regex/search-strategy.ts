import type { MatchResult, SearchStrategy } from "../types.js";
import PartialMatchRegExp, { features, hitEnd } from "regex-partial-match";
import { DEFAULT_OPTIONS } from "./default-options.js";
import validateInput from "./input-validation.js";
import advanceToMatch from "./advance-to-match.js";
import endsAtHaystackEnd from "./ends-at-haystack-end.js";
import nonMatch from "./non-match.js";
import sameCaptures from "./same-captures.js";
import skipOneCodeUnitPastZeroLengthMatch from "./skip-one-code-unit-past-zero-length-match.js";
import takeMatch from "./take-match.js";
import type {
  RegexSearchState,
  RegexSearchStrategyOptions,
  ScanCursor
} from "./types.js";
import StringBufferStrategyBase from "../string-buffer-strategy-base.js";

const FEATURES_NEEDING_PROBE_BEFORE_END = [
  "backreference",
  "namedBackreference",
  "lookahead"
] as const;

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
 * import { searchStrategyFactory, SyncReplacementTransformEngine } from 'replace-content-transformer';
 *
 * // Factory automatically creates RegexSearchStrategy for RegExp input
 * const strategy = searchStrategyFactory(/\{\{(\w+)\}\}/);
 *
 * const engine = new SyncReplacementTransformEngine({
 *   searchStrategy: strategy,
 *   replacement: (match) => `Value: ${match[1]}`
 * });
 * ```
 */
export class RegexSearchStrategy
  extends StringBufferStrategyBase<RegExpExecArray>
  implements SearchStrategy<RegexSearchState, RegExpExecArray>
{
  private readonly completeMatchRegex!: RegExp;
  private readonly partialMatchRegex: PartialMatchRegExp;
  private readonly lookaheadConfirmationRegex: RegExp | null;
  private readonly probesCandidatesEndingBeforeHaystackEnd: boolean;
  private readonly maxBufferLength!: number;
  private readonly minCandidateLengthToBackOff!: number;
  private readonly bufferGrowthFactorBetweenEvaluations!: number;
  private readonly onGuardExceeded: RegexSearchStrategyOptions["onGuardExceeded"];

  constructor(needle: RegExp, options?: RegexSearchStrategyOptions) {
    super();
    Object.assign(this, DEFAULT_OPTIONS, options, { completeMatchRegex: needle });
    const partialMatchRegex = new PartialMatchRegExp(needle);
    validateInput(partialMatchRegex);
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

  override createState(): RegexSearchState {
    return { ...super.createState(), evaluatedBufferLength: 0 };
  }

  private canSkipEvaluation(
    state: RegexSearchState,
    bufferedLength: number
  ): boolean {
    return (
      state.evaluatedBufferLength >= this.minCandidateLengthToBackOff &&
      bufferedLength <=
        state.evaluatedBufferLength * this.bufferGrowthFactorBetweenEvaluations &&
      bufferedLength <= this.maxBufferLength
    );
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
    state: RegexSearchState
  ): Generator<MatchResult<RegExpExecArray>, void, undefined> {
    const bufferLength = state.buffer.length;
    if (this.canSkipEvaluation(state, bufferLength + haystack.length)) {
      state.buffer += haystack;
      state.streamOffset += haystack.length;
      return;
    }
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
          const heldBackFrom = cursor.reportedUpTo + matchStart;
          const heldBack = haystack.slice(heldBackFrom);
          const exceedsGuard = heldBack.length > this.maxBufferLength;
          cursor.reportedUpTo = length;
          state.buffer = exceedsGuard ? "" : heldBack;
          state.evaluatedBufferLength = state.buffer.length;
          if (matchStart > 0)
            yield nonMatch(remainingHaystack.slice(0, matchStart));
          if (exceedsGuard) {
            this.onGuardExceeded?.({ bufferLength: heldBack.length });
            for (const result of this.settle(
              heldBack,
              baseOffset + heldBackFrom
            ))
              yield result;
          }
          return;
        }

        state.buffer = "";
        state.evaluatedBufferLength = 0;
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
    state: RegexSearchState
  ): Generator<MatchResult<RegExpExecArray>, void, undefined> {
    const buffer = state.buffer;
    const baseOffset = state.streamOffset - buffer.length;
    state.buffer = "";
    state.streamOffset = 0;
    state.evaluatedBufferLength = 0;
    for (const result of this.settle(buffer, baseOffset)) yield result;
  }

  private settle(
    buffer: string,
    baseOffset: number
  ): MatchResult<RegExpExecArray>[] {
    const settled: MatchResult<RegExpExecArray>[] = [];
    const cursor: ScanCursor = { reportedUpTo: 0 };
    while (cursor.reportedUpTo < buffer.length) {
      const finalMatch = this.completeMatchRegex.exec(
        buffer.substring(cursor.reportedUpTo)
      );
      if (finalMatch === null) break;

      if (finalMatch[0].length === 0) {
        settled.push(
          skipOneCodeUnitPastZeroLengthMatch(buffer, cursor, finalMatch.index)
        );
        continue;
      }
      const precedingContent = advanceToMatch(finalMatch, buffer, cursor);
      if (precedingContent) settled.push(precedingContent);
      settled.push(takeMatch(finalMatch, cursor, baseOffset));
    }

    if (cursor.reportedUpTo < buffer.length) {
      settled.push(nonMatch(buffer.slice(cursor.reportedUpTo)));
    }
    return settled;
  }

  override matchToString(match: RegExpExecArray): string {
    return match[0];
  }
}
