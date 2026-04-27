import type { MatchResult, SearchStrategy } from "../types.js";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../string-buffer-strategy-base.js";

export type LoopedIndexOfAnchoredSearchState = StringBufferState & {
  /** Index of the current needle being matched in a multi-needle sequence */
  currentNeedleIndex: number;
};

/**
 * A high-performance search strategy for finding sequential string patterns (anchor sequences)
 * using smart partial matching to avoid unnecessary buffering.
 *
 * Similar to the buffered indexOf anchored strategy
 * (https://github.com/TomStrepsil/replace-content-transformer/blob/64c8d74ea8651401375bf01c00372fcdf2dbfcbb/src/search-strategies/benchmarking/buffered-indexOf-anchored/README.md)
 * but uses intelligent partial matching at chunk boundaries - only buffering when there's 
 * actually a potential partial match, rather than blindly buffering the maximum possible 
 * partial match length.
 *
 * This strategy efficiently searches for sequences of strings that must appear in order,
 * separated by any content. For example, `['{{', 'name', '}}']` matches `{{name}}` or
 * `{{  name  }}`. The implementation uses `String.indexOf()` for optimal performance
 * and only buffers when a partial match is detected at a chunk boundary.
 *
 * **Performance characteristics**:
 * - Faster than BufferedIndexOfAnchored in "no matches" scenarios (~27% improvement)
 * - Avoids unnecessary buffering when no partial matches exist
 * - Minimal overhead for partial match detection
 * - Optimal for streams with sparse or no matches
 */
export class LoopedIndexOfAnchoredSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<LoopedIndexOfAnchoredSearchState>
{
  private readonly needles: string[];

  constructor(needles: string[]) {
    super();
    this.needles = needles;
  }

  createState(): LoopedIndexOfAnchoredSearchState {
    return { ...super.createState(), currentNeedleIndex: 0 };
  }

  *processChunk(
    haystack: string,
    state: LoopedIndexOfAnchoredSearchState
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
            for (
              let partialLength = currentNeedle.length - 1;
              partialLength >= 1;
              partialLength--
            ) {
              const haystackSuffix = haystack.slice(-partialLength);
              const needlePrefix = currentNeedle.slice(0, partialLength);
              if (haystackSuffix === needlePrefix) {
                const beforePartial = haystack.slice(position, -partialLength);
                position = length - partialLength;
                if (beforePartial) {
                  yield {
                    isMatch: false,
                    content: beforePartial
                  };
                }
                return;
              }
            }

            const nonMatch = haystack.slice(position);
            position = length;
            yield { isMatch: false, content: nonMatch };
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
          const content = haystack.slice(matchStartPosition, position);
          const startIndex = baseOffset + matchStartPosition;
          const endIndex = baseOffset + position;
          yield {
            isMatch: true,
            content,
            streamIndices: [startIndex, endIndex]
          };
        }
      }
    } finally {
      const isMidMatch = state.currentNeedleIndex > 0;
      state.buffer = haystack.slice(isMidMatch ? matchStartPosition : position);
      state.streamOffset += haystack.length - bufferLength;
    }
  }

  flush(state: LoopedIndexOfAnchoredSearchState): string {
    state.currentNeedleIndex = 0;
    return super.flush(state);
  }
}
