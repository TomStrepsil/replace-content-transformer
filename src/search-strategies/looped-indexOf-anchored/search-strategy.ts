import type { MatchResult, SearchStrategy } from "../types.ts";
import StringBufferStrategyBase, {
  type StringBufferState,
  createStringBufferState,
  flushStringBuffer
} from "../string-buffer-strategy-base.ts";

/**
 * State object for {@link createLoopedIndexOfAnchoredSearchStrategy}.
 */
export type LoopedIndexOfAnchoredSearchState = StringBufferState & {
  /** Index of the current needle being matched in a multi-needle sequence */
  currentNeedleIndex: number;
};

/**
 * Creates a high-performance search strategy for finding sequential string patterns (anchor sequences)
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
export function createLoopedIndexOfAnchoredSearchStrategy(
  needles: string[]
): SearchStrategy<LoopedIndexOfAnchoredSearchState> {
  return {
    createState(): LoopedIndexOfAnchoredSearchState {
      return { ...createStringBufferState(), currentNeedleIndex: 0 };
    },

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
          const currentNeedle = needles[state.currentNeedleIndex];
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
                    yield { isMatch: false, content: beforePartial };
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
            (state.currentNeedleIndex + 1) % needles.length;
          if (state.currentNeedleIndex === 0) {
            yield {
              isMatch: true,
              content: haystack.slice(matchStartPosition, position)
            };
          }
        }
      } finally {
        const isMidMatch = state.currentNeedleIndex > 0;
        state.buffer = haystack.slice(isMidMatch ? matchStartPosition : position);
      }
    },

    flush(state: LoopedIndexOfAnchoredSearchState): string {
      state.currentNeedleIndex = 0;
      return flushStringBuffer(state);
    }
  };
}

/**
 * @deprecated Use {@link createLoopedIndexOfAnchoredSearchStrategy} instead.
 */
export class LoopedIndexOfAnchoredSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<LoopedIndexOfAnchoredSearchState>
{
  #strategy: SearchStrategy<LoopedIndexOfAnchoredSearchState>;

  constructor(needles: string[]) {
    super();
    this.#strategy = createLoopedIndexOfAnchoredSearchStrategy(needles);
  }

  createState(): LoopedIndexOfAnchoredSearchState {
    return this.#strategy.createState();
  }

  *processChunk(
    haystack: string,
    state: LoopedIndexOfAnchoredSearchState
  ): Generator<MatchResult, void, undefined> {
    yield* this.#strategy.processChunk(haystack, state);
  }

  flush(state: LoopedIndexOfAnchoredSearchState): string {
    return this.#strategy.flush(state);
  }
}
