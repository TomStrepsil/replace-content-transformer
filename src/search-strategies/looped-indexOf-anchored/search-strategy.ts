import type { MatchResult, SearchStrategy } from "../types.ts";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../string-buffer-strategy-base.ts";

/**
 * State object for {@link LoopedIndexOfAnchoredSearchStrategy}.
 */
type LoopedIndexOfAnchoredSearchState = StringBufferState & {
  /** Index of the current needle being matched in a multi-needle sequence */
  currentNeedleIndex: number;
};

/**
 * A high-performance search strategy for finding sequential string patterns (anchor sequences)
 * using smart partial matching to avoid unnecessary buffering.
 *
 * Similar to {@link BufferedIndexOfAnchoredSearchStrategy} but uses intelligent partial matching
 * at chunk boundaries - only buffering when there's actually a potential partial match, rather
 * than blindly buffering the maximum possible partial match length.
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
    haystack = state.buffer + haystack;
    const length = haystack.length;
    let position = 0;
    let matchStartPosition;
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
                  yield { content: beforePartial, match: false };
                }
                return;
              }
            }

            if (position < length) {
              const content = haystack.slice(position);
              position = length;
              yield { content, match: false };
            }
          }
          return;
        }

        if (state.currentNeedleIndex === 0) {
          if (index > position) {
            const content = haystack.slice(position, index);
            position = index;
            yield { content, match: false };
          }
          matchStartPosition = index;
        }

        position = index + currentNeedle.length;
        state.currentNeedleIndex =
          (state.currentNeedleIndex + 1) % this.needles.length;
        if (state.currentNeedleIndex === 0) {
          yield {
            content: haystack.slice(matchStartPosition, position),
            match: true
          };
        }
      }
    } finally {
      const isMidMatch = state.currentNeedleIndex > 0;
      state.buffer = haystack.slice(isMidMatch ? matchStartPosition : position);
    }
  }

  flush(state: LoopedIndexOfAnchoredSearchState): string {
    state.currentNeedleIndex = 0;
    return super.flush(state);
  }
}
