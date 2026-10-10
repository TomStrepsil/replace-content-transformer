import {
  LoopedIndexOfAnchoredSearchState,
  LoopedIndexOfAnchoredSearchStrategy
} from "../looped-indexOf-anchored/search-strategy.js";
import type { MatchResult, SearchStrategy } from "../types.js";

/** Per-stream state for {@link BalancedPairSearchStrategy}. */
export interface BalancedPairSearchState extends LoopedIndexOfAnchoredSearchState {
  /** Number of opening delimiters currently awaiting a closing delimiter. */
  nestingLevel: number;
  /** Content of the pair accumulated so far, from its first opening delimiter. */
  balancedBuffer: string;
  /** Stream offset at which the pair being accumulated began. */
  balancedBufferStart: number;
}

/**
 * A search strategy for matching balanced delimiter pairs, including nested
 * occurrences. A match completes only when every opening delimiter inside it
 * has a corresponding closing delimiter, so `(` and `)` match the whole of
 * `((a) b)` rather than stopping at the first `)`.
 *
 * Matches may span chunk boundaries. Unbalanced content is emitted verbatim
 * at end of stream. The match content is the matched string, delimiters
 * included.
 *
 * See [README](./README.md) for the algorithm.
 *
 * @throws If `opening` or `closing` is an empty string.
 *
 * @example
 * ```typescript
 * import { BalancedPairSearchStrategy, SyncReplacementTransformEngine } from 'replace-content-transformer';
 *
 * const engine = new SyncReplacementTransformEngine({
 *   searchStrategy: new BalancedPairSearchStrategy('{{', '}}'),
 *   replacement: (match) => match.toUpperCase()
 * });
 * ```
 */
export class BalancedPairSearchStrategy implements SearchStrategy<
  BalancedPairSearchState,
  string
> {
  private anchorStringSearchStrategy: LoopedIndexOfAnchoredSearchStrategy;
  private readonly opening: string;

  /**
   * @param opening - String that opens a pair. Each occurrence inside a match increases the nesting level.
   * @param closing - String that closes a pair. The match ends at the closing string that returns the nesting level to zero.
   */
  constructor(opening: string, closing: string) {
    this.opening = opening;
    this.anchorStringSearchStrategy = new LoopedIndexOfAnchoredSearchStrategy([
      opening,
      closing
    ]);
  }

  createState(): BalancedPairSearchState {
    return {
      ...this.anchorStringSearchStrategy.createState(),
      nestingLevel: 0,
      balancedBuffer: "",
      balancedBufferStart: 0
    };
  }

  *processChunk(
    haystack: string,
    state: BalancedPairSearchState
  ): Generator<MatchResult, void, undefined> {
    let prevMatchLength = 0;
    for (const matchResult of this.anchorStringSearchStrategy.processChunk(
      haystack,
      state
    )) {
      if (!matchResult.isMatch) {
        yield matchResult;
        continue;
      }
      const newContent = matchResult.content.slice(prevMatchLength);
      prevMatchLength = matchResult.content.length;

      if (state.balancedBuffer === "") {
        state.balancedBufferStart = matchResult.streamIndices[0];
      }
      state.balancedBuffer += newContent;
      state.nestingLevel--;
      let cursor = 0;
      while ((cursor = newContent.indexOf(this.opening, cursor)) !== -1) {
        state.nestingLevel++;
        cursor += this.opening.length;
      }

      if (state.nestingLevel > 0) {
        state.currentNeedleIndex = 1;
      } else {
        state.nestingLevel = 0;
        const content = state.balancedBuffer;
        state.balancedBuffer = "";
        prevMatchLength = 0;
        yield {
          isMatch: true,
          content,
          streamIndices: [
            state.balancedBufferStart,
            matchResult.streamIndices[1]
          ]
        };
      }
    }
    if (state.nestingLevel > 0) {
      state.buffer = state.buffer.slice(state.balancedBuffer.length);
      state.matchConsumedLength = 0;
    }
  }

  *flush(
    state: BalancedPairSearchState
  ): Generator<MatchResult, void, undefined> {
    const flushed = state.balancedBuffer;
    state.balancedBuffer = "";
    state.balancedBufferStart = 0;
    state.nestingLevel = 0;
    if (flushed) yield { isMatch: false, content: flushed };
    yield* this.anchorStringSearchStrategy.flush(state);
  }

  matchToString(match: string): string {
    return match;
  }
}
