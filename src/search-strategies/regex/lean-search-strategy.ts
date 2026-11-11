import type { MatchSink, SearchStrategy } from "../types.js";
import type PartialMatchRegExp from "regex-partial-match";
import features from "regex-partial-match/features";
import hitEnd from "regex-partial-match/hitEnd";
import { DEFAULT_OPTIONS } from "./default-options.js";
import bufferGuard, { type BufferGuard } from "../buffer-guard.js";
import validateInput from "./input-validation.js";
import validateOptions from "./options-validation.js";
import advanceToMatch from "./advance-to-match.js";
import endsAtHaystackEnd from "./ends-at-haystack-end.js";
import sameCaptures from "./same-captures.js";
import skipOneCodePointPastZeroLengthMatch from "./skip-one-code-point-past-zero-length-match.js";
import codeUnitsInCodePointAt from "../code-units-in-code-point-at.js";
import takeMatch from "./take-match.js";
import type {
  RegexSearchState,
  StreamRegexMatch,
  RegexSearchStrategyOptions,
  ScanCursor
} from "./types.js";
import StringBufferStrategyBase from "../string-buffer-strategy-base.js";

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
 * @throws {RangeError} If `maxBufferLength` is not a whole number of at least 0,
 * `minCandidateLengthToBackOff` is not a number of at least 0, or
 * `bufferGrowthFactorBetweenEvaluations` is not a number of at least 1. 
 * `Infinity` is allowed; `undefined` selects the default.
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
    bufferedLength: number
  ): boolean {
    return (
      state.evaluatedBufferLength >= this.minCandidateLengthToBackOff &&
      bufferedLength <=
        state.evaluatedBufferLength * this.bufferGrowthFactorBetweenEvaluations &&
      bufferedLength <= this.guard.maxBufferLength
    );
  }

  private settledMatch(
    candidate: RegExpExecArray | null,
    haystack: string
  ): RegExpExecArray | null {
    if (candidate === null) return null;
    if (endsAtHaystackEnd(candidate, haystack)) return null;
    if (candidate[0].length > this.guard.maxBufferLength) return null;
    const confirmation = this.lookaheadConfirmationRegex;
    if (confirmation === null) return candidate;
    if (hitEnd(this.partialMatchRegex, candidate)) return null;

    confirmation.lastIndex = candidate.index;
    const completeMatch = confirmation.exec(haystack);
    if (completeMatch === null) return null;
    return sameCaptures(candidate, completeMatch) ? completeMatch : null;
  }

  processChunk(
    haystack: string,
    state: RegexSearchState,
    sink: MatchSink<StreamRegexMatch>
  ): undefined {
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
    const windowLength = this.guard.maxBufferLength + 1;
    try {
      while (cursor.reportedUpTo < length) {
        const windowEnd = this.windowEnd(haystack, cursor.reportedUpTo + windowLength);
        const window = haystack.substring(cursor.reportedUpTo, windowEnd);
        const candidate = this.partialMatchRegex.exec(window);
        const settledMatch = this.settledMatch(candidate, window);
        state.buffer = "";
        state.evaluatedBufferLength = 0;

        if (settledMatch === null) {
          const start = cursor.reportedUpTo + (candidate?.index ?? window.length);
          const overLong = windowEnd - start > this.guard.maxBufferLength;
          const reportTo = overLong ? this.guard.release(haystack, start) : start;
          const content = haystack.slice(cursor.reportedUpTo, reportTo);
          cursor.reportedUpTo = reportTo;
          if (content) sink.reportText(content);
          if (overLong || windowEnd < length) continue;
          state.buffer = haystack.slice(reportTo);
          state.evaluatedBufferLength = state.buffer.length;
          cursor.reportedUpTo = length;
          return;
        }

        if (!this.reportSettledMatch(settledMatch, haystack, cursor, baseOffset, sink)) return;
      }
    } finally {
      if (cursor.reportedUpTo < length) {
        state.buffer += haystack.slice(cursor.reportedUpTo);
      }
      state.streamOffset += haystack.length - bufferLength;
    }
  }

  private reportSettledMatch(
    match: RegExpExecArray,
    haystack: string,
    cursor: ScanCursor,
    baseOffset: number,
    sink: MatchSink<StreamRegexMatch>
  ): boolean {
    if (match[0].length === 0) {
      sink.reportText(skipOneCodePointPastZeroLengthMatch(haystack, cursor, match.index));
      return true;
    }
    const precedingContent = advanceToMatch(match, haystack, cursor);
    if (precedingContent) sink.reportText(precedingContent);
    return sink.reportMatch(match, takeMatch(match, cursor, baseOffset));
  }

  override flush(state: RegexSearchState): string {
    state.evaluatedBufferLength = 0;
    return super.flush(state);
  }

  settle(state: RegexSearchState, sink: MatchSink<StreamRegexMatch>): undefined {
    const baseOffset = state.streamOffset - state.buffer.length;
    const buffer = this.flush(state);
    const cursor: ScanCursor = { reportedUpTo: 0 };
    try {
      while (cursor.reportedUpTo < buffer.length) {
        const finalMatch = this.completeMatchRegex.exec(
          buffer.substring(cursor.reportedUpTo)
        );
        if (finalMatch === null) break;

        if (!this.reportSettledMatch(finalMatch, buffer, cursor, baseOffset, sink)) return;
      }

      if (cursor.reportedUpTo < buffer.length) {
        const rest = buffer.slice(cursor.reportedUpTo);
        cursor.reportedUpTo = buffer.length;
        sink.reportText(rest);
      }
    } finally {
      if (cursor.reportedUpTo < buffer.length) {
        state.buffer = buffer.slice(cursor.reportedUpTo);
        state.streamOffset = baseOffset + buffer.length;
      }
    }
  }

  override matchToString(match: StreamRegexMatch): string {
    return match[0];
  }

  private windowEnd(haystack: string, end: number): number {
    if (end >= haystack.length) return haystack.length;
    return end - 1 + codeUnitsInCodePointAt(haystack, end - 1);
  }
}
