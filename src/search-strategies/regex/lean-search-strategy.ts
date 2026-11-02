import type { MatchResult, SearchStrategy } from "../types.js";
import type PartialMatchRegExp from "regex-partial-match";
import features from "regex-partial-match/features";
import hitEnd from "regex-partial-match/hitEnd";
import { DEFAULT_OPTIONS } from "./default-options.js";
import bufferGuard, { type BufferGuard } from "../buffer-guard.js";
import validateInput from "./input-validation.js";
import validateOptions from "./options-validation.js";
import advanceToMatch from "./advance-to-match.js";
import endsAtHaystackEnd from "./ends-at-haystack-end.js";
import endsWithHighSurrogate from "../../ends-with-high-surrogate.js";
import nonMatch from "./non-match.js";
import sameCaptures from "./same-captures.js";
import skipOneCodePointPastZeroLengthMatch from "./skip-one-code-point-past-zero-length-match.js";
import takeMatch from "./take-match.js";
import type {
  RegexSearchState,
  StreamRegexMatch,
  RegexSearchStrategyOptions,
  ScanCursor
} from "./types.js";
import StringBufferStrategyBase from "../string-buffer-strategy-base.js";

const SCAN_PIECE_LENGTH = 64 * 1024;

/**
 * The regex search strategy, taking a `PartialMatchRegExp` the consumer has
 * built rather than a `RegExp`, so that a bundle need not include the
 * `PartialMatchRegExp` class exported from `regex-partial-match`'s default
 * entry. Behaves exactly as `RegexSearchStrategy` does for the same
 * pattern.
 *
 * Build `partial` from `regex-partial-match/core`, or from `withModules()`
 * with the modules the pattern needs: a backreference needs `backreferences`;
 * `carets` is never needed, since `^` and the `m` flag are rejected. See
 * [Lean Bundles](./README.md#lean-bundles).
 *
 * @throws {TypeError} If `partial` is not a `PartialMatchRegExp` instance.
 *
 * @throws If `partial`'s pattern uses a construct whose truth a streaming scan
 * cannot decide at a chunk boundary — negative lookaheads, lookbehinds, word
 * boundaries, the `^`/`$` anchors — or the `g`, `y` or `m` flags. See
 * [Limitations](./README.md#limitations).
 *
 * @throws {TypeError} If `maxBufferLength`, `minCandidateLengthToBackOff` or
 * `bufferGrowthFactorBetweenEvaluations` is not a number.
 *
 * @throws {RangeError} If `maxBufferLength` or `minCandidateLengthToBackOff` is
 * less than 0, `bufferGrowthFactorBetweenEvaluations` is less than 1, or either is
 * `NaN`. `Infinity` is allowed; `undefined` selects the default.
 *
 * @example
 * ```typescript
 * import PartialMatchRegExp, { withModules } from "regex-partial-match/core";
 * import backreferences from "regex-partial-match/modules/backreferences";
 * import { LeanRegexSearchStrategy } from "replace-content-transformer";
 *
 * new LeanRegexSearchStrategy(new PartialMatchRegExp(/\{\{(\w+)\}\}/));
 *
 * const WithBackreferences = withModules(backreferences);
 * new LeanRegexSearchStrategy(new WithBackreferences(/(["'])(.*?)\1/));
 * ```
 */
export class LeanRegexSearchStrategy
  extends StringBufferStrategyBase<StreamRegexMatch>
  implements SearchStrategy<RegexSearchState, StreamRegexMatch>
{
  private readonly completeMatchRegex: RegExp;
  private readonly partialMatchRegex: PartialMatchRegExp;
  private readonly lookaheadConfirmationRegex: RegExp | null;
  private readonly guard: BufferGuard;
  private readonly minCandidateLengthToBackOff: number;
  private readonly bufferGrowthFactorBetweenEvaluations: number;

  constructor(
    partialMatchRegex: PartialMatchRegExp,
    {
      minCandidateLengthToBackOff = DEFAULT_OPTIONS.minCandidateLengthToBackOff,
      bufferGrowthFactorBetweenEvaluations = DEFAULT_OPTIONS.bufferGrowthFactorBetweenEvaluations,
      ...guardOptions
    }: RegexSearchStrategyOptions = {}
  ) {
    super();
    this.guard = bufferGuard(guardOptions);
    validateOptions({
      minCandidateLengthToBackOff,
      bufferGrowthFactorBetweenEvaluations
    });
    validateInput(partialMatchRegex);
    this.partialMatchRegex = partialMatchRegex;
    this.completeMatchRegex = new RegExp(partialMatchRegex.source, partialMatchRegex.flags);
    this.minCandidateLengthToBackOff = minCandidateLengthToBackOff;
    this.bufferGrowthFactorBetweenEvaluations =
      bufferGrowthFactorBetweenEvaluations;
    this.lookaheadConfirmationRegex = features(partialMatchRegex).has("lookahead")
      ? new RegExp(partialMatchRegex.source, `${partialMatchRegex.flags}y`)
      : null;
  }

  override createState(): RegexSearchState {
    return { ...super.createState(), evaluatedBufferLength: 0 };
  }

  private canSkipEvaluation(
    state: RegexSearchState,
    candidateLength: number
  ): boolean {
    return (
      state.evaluatedBufferLength >= this.minCandidateLengthToBackOff &&
      candidateLength <=
        state.evaluatedBufferLength * this.bufferGrowthFactorBetweenEvaluations &&
      candidateLength <= this.guard.maxBufferLength
    );
  }

  private settledMatch(
    candidate: RegExpExecArray | null,
    haystack: string
  ): RegExpExecArray | null {
    if (candidate === null) return null;
    if (endsAtHaystackEnd(candidate, haystack)) return null;
    const confirmation = this.lookaheadConfirmationRegex;
    if (confirmation === null) return candidate;
    if (hitEnd(this.partialMatchRegex, candidate)) return null;

    confirmation.lastIndex = candidate.index;
    const completeMatch = confirmation.exec(haystack);
    if (completeMatch === null) return null;
    return sameCaptures(candidate, completeMatch) ? completeMatch : null;
  }

  *processChunk(
    chunk: string,
    state: RegexSearchState
  ): Generator<MatchResult<StreamRegexMatch>, void, undefined> {
    const bufferLength = state.buffer.length;
    const baseOffset = state.streamOffset - bufferLength;
    const haystack = state.buffer + chunk;
    const length = haystack.length;
    const cursor: ScanCursor = { reportedUpTo: 0 };
    let scanEnd = bufferLength;
    let candidateFrom = 0;
    try {
      while (scanEnd < length) {
        scanEnd = Math.min(scanEnd + SCAN_PIECE_LENGTH, length);
        if (scanEnd < length && endsWithHighSurrogate(haystack, scanEnd)) scanEnd++;
        if (this.canSkipEvaluation(state, scanEnd - candidateFrom)) continue;
        let decidableTo = Infinity;
        if (scanEnd < length) {
          decidableTo = scanEnd - this.guard.maxBufferLength;
          if (endsWithHighSurrogate(haystack, decidableTo)) decidableTo--;
        }
        let settling = false;
        while (cursor.reportedUpTo < scanEnd) {
          const remainingHaystack = haystack.substring(cursor.reportedUpTo, scanEnd);
          const candidate = (
            settling ? this.completeMatchRegex : this.partialMatchRegex
          ).exec(remainingHaystack);
          const matchStart = candidate?.index ?? remainingHaystack.length;
          const settledMatch = settling
            ? candidate
            : this.settledMatch(candidate, remainingHaystack);

          const heldBackFrom = cursor.reportedUpTo + matchStart;
          if (settledMatch === null || heldBackFrom >= decidableTo) {
            const exceedsGuard =
              settledMatch === null && scanEnd - heldBackFrom > this.guard.maxBufferLength;
            const reportedTo = exceedsGuard
              ? heldBackFrom
              : Math.max(cursor.reportedUpTo, Math.min(heldBackFrom, decidableTo));
            const reportedLength = reportedTo - cursor.reportedUpTo;
            cursor.reportedUpTo = reportedTo;
            candidateFrom = settledMatch === null ? heldBackFrom : scanEnd;
            state.evaluatedBufferLength = scanEnd - candidateFrom;
            if (reportedLength > 0)
              yield nonMatch(remainingHaystack.slice(0, reportedLength));
            if (!exceedsGuard) break;
            settling = true;
            this.guard.onGuardExceeded?.({
              streamIndices: [baseOffset + heldBackFrom, baseOffset + scanEnd]
            });
            continue;
          }

          state.evaluatedBufferLength = 0;
          if (settledMatch[0].length === 0) {
            yield skipOneCodePointPastZeroLengthMatch(
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
      }
    } finally {
      state.buffer = haystack.slice(cursor.reportedUpTo);
      state.streamOffset += length - bufferLength;
    }
  }

  override flush(state: RegexSearchState): string {
    state.evaluatedBufferLength = 0;
    return super.flush(state);
  }

  settle(
    state: RegexSearchState
  ): Generator<MatchResult<StreamRegexMatch>, void, undefined> {
    const baseOffset = state.streamOffset - state.buffer.length;
    return this.settleBuffer(this.flush(state), baseOffset, state);
  }

  private *settleBuffer(
    buffer: string,
    baseOffset: number,
    state: RegexSearchState
  ): Generator<MatchResult<StreamRegexMatch>, void, undefined> {
    const cursor: ScanCursor = { reportedUpTo: 0 };
    try {
      while (cursor.reportedUpTo < buffer.length) {
        const finalMatch = this.completeMatchRegex.exec(
          buffer.substring(cursor.reportedUpTo)
        );
        if (finalMatch === null) break;

        if (finalMatch[0].length === 0) {
          yield skipOneCodePointPastZeroLengthMatch(
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
        const rest = buffer.slice(cursor.reportedUpTo);
        cursor.reportedUpTo = buffer.length;
        yield nonMatch(rest);
      }
    } finally {
      if (cursor.reportedUpTo < buffer.length) {
        state.buffer = buffer.slice(cursor.reportedUpTo);
      }
    }
  }

  override matchToString(match: StreamRegexMatch): string {
    return match[0];
  }
}
