import type { BufferGuardOptions } from "../../../../../../src/search-strategies/types.ts";
import type { MatchResult } from "../../../../../search-strategy-results.ts";
import StringBufferStrategyBase from "../../../../../../src/search-strategies/string-buffer-strategy-base.ts";
import bufferGuard, { type BufferGuard } from "../../../../../../src/search-strategies/buffer-guard.ts";
import partialMatchLength from "../../../../../../src/search-strategies/looped-indexOf-anchored/partial-match-length.ts";
import validateNeedles from "../../../../../../src/search-strategies/looped-indexOf-anchored/validate-needles.ts";
import type { LoopedIndexOfAnchoredSearchState } from "../../../../../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";
import type { GeneratorSearchStrategy } from "../types.ts";

export class LoopedIndexOfAnchoredGeneratorSearchStrategy
  extends StringBufferStrategyBase
  implements GeneratorSearchStrategy<LoopedIndexOfAnchoredSearchState>
{
  private readonly needles: string[];
  private readonly guard: BufferGuard;

  constructor(needles: string[], options?: BufferGuardOptions) {
    super();
    validateNeedles(needles);
    this.needles = [...needles];
    this.guard = bufferGuard(options, needles.join("").length);
  }

  createState(): LoopedIndexOfAnchoredSearchState {
    return { ...super.createState(), currentNeedleIndex: 0, matchConsumedLength: 0 };
  }

  *processChunk(
    haystack: string,
    state: LoopedIndexOfAnchoredSearchState
  ): Generator<MatchResult, void, undefined> {
    const bufferLength = state.buffer.length;
    const baseOffset = state.streamOffset - bufferLength;
    haystack = state.buffer + haystack;
    const length = haystack.length;
    let position = state.matchConsumedLength;
    let matchStartPosition = 0;
    try {
      for (;;) {
        const currentNeedle = this.needles[state.currentNeedleIndex];
        let index: number;
        if (state.currentNeedleIndex === 0) {
          index = haystack.indexOf(currentNeedle, position);
          if (index === -1) {
            const resumeAt =
              length - partialMatchLength(haystack, currentNeedle, length - position);
            const nonMatch = haystack.slice(position, resumeAt);
            position = resumeAt;
            if (nonMatch) yield { isMatch: false, content: nonMatch };
            return;
          }
          if (index > position) {
            const nonMatch = haystack.slice(position, index);
            position = index;
            yield { isMatch: false, content: nonMatch };
          }
          matchStartPosition = index;
        } else {
          const limit = matchStartPosition + this.guard.maxBufferLength;
          const window = limit < length ? haystack.slice(0, limit) : haystack;
          index = window.indexOf(currentNeedle, position);
          if (index === -1) {
            if (length < limit) return;
            const releasedTo = this.guard.release(haystack, matchStartPosition);
            const nonMatch = haystack.slice(matchStartPosition, releasedTo);
            state.currentNeedleIndex = 0;
            position = releasedTo;
            yield { isMatch: false, content: nonMatch };
            continue;
          }
        }

        position = index + currentNeedle.length;
        state.currentNeedleIndex =
          (state.currentNeedleIndex + 1) % this.needles.length;
        if (state.currentNeedleIndex === 0) {
          yield {
            isMatch: true,
            content: haystack.slice(matchStartPosition, position),
            streamIndices: [baseOffset + matchStartPosition, baseOffset + position]
          };
        }
      }
    } finally {
      const isMidMatch = state.currentNeedleIndex > 0;
      state.matchConsumedLength = isMidMatch ? position - matchStartPosition : 0;
      state.buffer = haystack.slice(isMidMatch ? matchStartPosition : position);
      state.streamOffset += haystack.length - bufferLength;
    }
  }

  flush(state: LoopedIndexOfAnchoredSearchState): string {
    state.currentNeedleIndex = 0;
    state.matchConsumedLength = 0;
    return super.flush(state);
  }
}
