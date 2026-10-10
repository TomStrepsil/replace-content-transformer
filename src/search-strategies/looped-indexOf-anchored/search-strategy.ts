import type { MatchResult, SearchStrategy, StringBufferState } from "../types.js";
import StringBufferStrategyBase from "../string-buffer-strategy-base.js";
import partialMatchLength from "./partial-match-length.js";
import validateNeedles from "./validate-needles.js";

/** Per-stream state for {@link LoopedIndexOfAnchoredSearchStrategy}. */
export type LoopedIndexOfAnchoredSearchState = StringBufferState & {
  /** Index of the current needle being matched in a multi-needle sequence */
  currentNeedleIndex: number;
  /** Length of the buffered partial match already consumed by earlier anchors */
  matchConsumedLength: number;
};

/**
 * A search strategy for finding sequences of strings (anchors) that must appear
 * in order, separated by any content. For example, `['{{', 'name', '}}']`
 * matches `{{name}}` or `{{  name  }}`. A single anchor matches that string.
 *
 * Matches may span chunk boundaries. Content is only held back when the end
 * of a chunk could be the start of the first anchor, or while a match is
 * part-way through its sequence.
 *
 * Exposed publicly as `StringAnchorSearchStrategy`.
 *
 * @throws If `needles` is empty, or any needle is an empty string.
 */
export class LoopedIndexOfAnchoredSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<LoopedIndexOfAnchoredSearchState>
{
  private readonly needles: string[];

  constructor(needles: string[]) {
    super();
    validateNeedles(needles);
    this.needles = [...needles];
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
      while (position < length) {
        const searchingFirstNeedle = state.currentNeedleIndex === 0;
        const currentNeedle = this.needles[state.currentNeedleIndex];
        const index = haystack.indexOf(currentNeedle, position);

        if (index === -1) {
          if (searchingFirstNeedle) {
            const unreportedLength = length - position;
            const resumeAt =
              length -
              partialMatchLength(haystack, currentNeedle, unreportedLength);
            const nonMatch = haystack.slice(position, resumeAt);
            position = resumeAt;
            if (nonMatch) yield { isMatch: false, content: nonMatch };
          }
          return;
        }

        if (searchingFirstNeedle) {
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
      state.matchConsumedLength = isMidMatch ? position - matchStartPosition : 0;
      state.buffer = haystack.slice(isMidMatch ? matchStartPosition : position);
      state.streamOffset += haystack.length - bufferLength;
    }
  }

  *flush(
    state: LoopedIndexOfAnchoredSearchState
  ): Generator<MatchResult, void, undefined> {
    state.currentNeedleIndex = 0;
    state.matchConsumedLength = 0;
    yield* super.flush(state);
  }
}
