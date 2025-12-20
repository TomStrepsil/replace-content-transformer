import type { MatchResult, SearchStrategy } from "../../types.ts";
import StringBufferStrategyBase from "../../string-buffer-strategy-base.ts";

/**
 * State object for {@link BufferedIndexOfAnchoredSearchStrategy}.
 */
export type BufferedIndexOfAnchoredSearchState = {
  /** Buffer holding partial content that may contain incomplete matches spanning chunks */
  buffer: string;
  /** Index of the current needle being matched in a multi-needle sequence */
  currentNeedleIndex: number;
};

/**
 * A high-performance search strategy for finding sequential string patterns (anchor sequences).
 *
 * This strategy efficiently searches for sequences of strings that must appear in order,
 * separated by any content. For example, `['{{', 'name', '}}']` matches `{{name}}` or
 * `{{  name  }}`. The implementation uses `String.indexOf()` for optimal performance
 * and maintains a buffer to handle matches that span multiple chunks.
 *
 * **Features**:
 * - Matches sequential patterns (anchor sequences) like template delimiters
 * - Handles matches spanning chunk boundaries via internal buffering
 * - Extremely fast for simple string patterns (faster than regex)
 * - Case-sensitive exact string matching only
 *
 * **Exported as**: `StringAnchorSearchStrategy` in the main package exports.
 *
 * @example Single string pattern
 * ```typescript
 * import { searchStrategyFactory, StaticReplacementProcessor } from 'replace-content-transformer';
 *
 * // Factory automatically creates BufferedIndexOfAnchoredSearchStrategy
 * const strategy = searchStrategyFactory('{{placeholder}}');
 *
 * const processor = new StaticReplacementProcessor({
 *   searchStrategy: strategy,
 *   replacement: 'value'
 * });
 * ```
 *
 * @example Anchor sequence pattern
 * ```typescript
 * import { StringAnchorSearchStrategy, FunctionReplacementProcessor } from 'replace-content-transformer';
 *
 * // Matches opening {{, then any content, then closing }}
 * const strategy = new StringAnchorSearchStrategy(['{{', '}}']);
 *
 * const processor = new FunctionReplacementProcessor({
 *   searchStrategy: strategy,
 *   replacement: (match) => {
 *     const name = match.slice(2, -2).trim();
 *     return `<span>${name}</span>`;
 *   }
 * });
 * ```
 */
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
            const yieldUntil = length - (currentNeedle.length - 1);
            if (yieldUntil > position) {
              const content = haystack.slice(position, yieldUntil);
              position = yieldUntil;
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
}
