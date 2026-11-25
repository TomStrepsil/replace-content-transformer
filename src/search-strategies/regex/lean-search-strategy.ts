import type { MatchSink, SearchStrategy } from "../types.js";
import type PartialMatchRegExp from "regex-partial-match";
import features from "regex-partial-match/features";
import hitEnd from "regex-partial-match/hitEnd";
import { DEFAULT_OPTIONS } from "./default-options.js";
import bufferGuard, { type BufferGuard } from "../buffer-guard.js";
import HeldText from "../held-text.js";
import validateInput from "./input-validation.js";
import validateOptions from "./options-validation.js";
import codeUnitsInCodePointAt from "../code-units-in-code-point-at.js";
import type {
  RegexSearchState,
  StreamRegexMatch,
  RegexSearchStrategyOptions
} from "./types.js";

const sameCaptures = (candidate: RegExpExecArray, confirmed: RegExpExecArray) =>
  candidate.length === confirmed.length &&
  candidate.every((capture, group) => capture === confirmed[group]);

const shiftIndices = (indices: RegExpIndicesArray, offset: number) => {
  for (const entry of indices) {
    if (entry === undefined) continue;
    entry[0] += offset;
    entry[1] += offset;
  }
};

const toStreamMatch = (match: RegExpExecArray, startIndex: number): StreamRegexMatch => {
  if (match.indices) shiftIndices(match.indices, startIndex - match.index);
  const streamMatch = match as unknown as StreamRegexMatch;
  streamMatch.index = startIndex;
  streamMatch.input = undefined;
  return streamMatch;
};

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

  createState(): RegexSearchState {
    return { held: new HeldText(), evaluatedBufferLength: 0 };
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
    if (candidate.index + candidate[0].length === haystack.length) return null;
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
    const { held } = state;
    if (this.canSkipEvaluation(state, held.text.length + haystack.length)) {
      held.hold(haystack);
      return;
    }
    held.scan(haystack, sink, () => this.scan(state));
  }

  flush(state: RegexSearchState): string {
    state.evaluatedBufferLength = 0;
    return state.held.flush();
  }

  settle(state: RegexSearchState, sink: MatchSink<StreamRegexMatch>): undefined {
    state.evaluatedBufferLength = 0;
    state.held.scan("", sink, () => this.settleScan(state));
    if (!state.held.text) this.flush(state);
  }

  private settleScan(state: RegexSearchState): void {
    const { held } = state;
    const { text } = held;
    while (held.reportedTo < text.length) {
      const finalMatch = this.completeMatchRegex.exec(text.substring(held.reportedTo));
      if (finalMatch === null) break;
      if (!this.reportSettledMatch(finalMatch, held)) return;
    }
    held.reportText(text.length);
  }

  private scan(state: RegexSearchState): void {
    const { held } = state;
    const { text } = held;
    const length = text.length;
    const windowLength = this.guard.maxBufferLength + 1;
    while (held.reportedTo < length) {
      const from = held.reportedTo;
      const windowEnd = this.windowEnd(text, from + windowLength);
      const window = text.substring(from, windowEnd);
      const candidate = this.partialMatchRegex.exec(window);
      const settledMatch = this.settledMatch(candidate, window);
      state.evaluatedBufferLength = 0;

      if (settledMatch === null) {
        const start = from + (candidate?.index ?? window.length);
        const overLong = windowEnd - start > this.guard.maxBufferLength;
        held.reportText(overLong ? this.guard.release(text, start) : start);
        if (overLong || windowEnd < length) continue;
        state.evaluatedBufferLength = length - held.reportedTo;
        return;
      }

      if (!this.reportSettledMatch(settledMatch, held)) return;
    }
  }

  private reportSettledMatch(
    match: RegExpExecArray,
    held: Readonly<HeldText<StreamRegexMatch>>
  ): boolean {
    const { text } = held;
    const at = held.reportedTo + match.index;
    if (match[0].length === 0) {
      held.reportText(Math.min(at + codeUnitsInCodePointAt(text, at), text.length));
      return true;
    }
    held.reportText(at);
    return held.reportMatch(toStreamMatch(match, held.streamIndex(at)), at + match[0].length);
  }

  matchToString(match: StreamRegexMatch): string {
    return match[0];
  }

  private windowEnd(haystack: string, end: number): number {
    if (end >= haystack.length) return haystack.length;
    return end - 1 + codeUnitsInCodePointAt(haystack, end - 1);
  }
}
