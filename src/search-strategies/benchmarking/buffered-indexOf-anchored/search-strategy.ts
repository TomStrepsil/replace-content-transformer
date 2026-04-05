import type { MatchResult, SearchStrategy } from "../../types.ts";
import StringBufferStrategyBase from "../../string-buffer-strategy-base.ts";

export type BufferedIndexOfAnchoredSearchState = {
  /** Buffer holding partial content that may contain incomplete matches spanning chunks */
  buffer: string;
  /** Tracks absolute stream offset for position reporting */
  streamOffset: number;
  /** Index of the current needle being matched in a multi-needle sequence */
  currentNeedleIndex: number;
};

export class BufferedIndexOfAnchoredSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<BufferedIndexOfAnchoredSearchState>
{
  private readonly needles: string[];

  constructor(needles: string[]) {
    super();
    this.needles = needles;
  }

  createState(): BufferedIndexOfAnchoredSearchState {
    return { ...super.createState(), currentNeedleIndex: 0 };
  }

  *processChunk(
    haystack: string,
    state: BufferedIndexOfAnchoredSearchState
  ): Generator<MatchResult, void, undefined> {
    const bufferLength = state.buffer.length;
    const baseOffset = state.streamOffset - bufferLength;
    haystack = state.buffer + haystack;
    const length = haystack.length;
    let position = 0;
    let matchStartPosition = 0;
    try {
      while (position < length) {
        const currentNeedle = this.needles[state.currentNeedleIndex];
        const index = haystack.indexOf(currentNeedle, position);
        if (index === -1) {
          if (state.currentNeedleIndex === 0) {
            const yieldUntil = length - (currentNeedle.length - 1);
            if (yieldUntil > position) {
              const nonMatch = haystack.slice(position, yieldUntil);
              position = yieldUntil;
              yield { isMatch: false, content: nonMatch };
            }
          }
          return;
        }

        if (state.currentNeedleIndex === 0) {
          if (index > position) {
            const nonMatch = haystack.slice(position, index);
            position = index;
            yield { isMatch: false, content: nonMatch };
          }
          matchStartPosition = index;
        }

        position = index + currentNeedle.length;
        state.currentNeedleIndex =
          (state.currentNeedleIndex + 1) % this.needles.length;
        if (state.currentNeedleIndex === 0) {
          yield {
            isMatch: true,
            content: haystack.slice(matchStartPosition, position),
            streamIndices: [
              baseOffset + matchStartPosition,
              baseOffset + position
            ]
          };
        }
      }
    } finally {
      const isMidMatch = state.currentNeedleIndex > 0;
      state.buffer = haystack.slice(isMidMatch ? matchStartPosition : position);
      state.streamOffset += haystack.length - bufferLength;
    }
  }

  flush(state: BufferedIndexOfAnchoredSearchState): string {
    state.currentNeedleIndex = 0;
    return super.flush(state);
  }
}
