import {
  acceptMatch,
  type AnchorOptions,
  type LoopedIndexOfAnchoredSearchState,
  LoopedIndexOfAnchoredSearchStrategy
} from "../looped-indexOf-anchored/search-strategy.js";
import type { BufferGuardOptions, MatchSink, SearchStrategy } from "../types.js";

/** Per-stream state for {@link BalancedPairSearchStrategy}. */
export type BalancedPairSearchState = LoopedIndexOfAnchoredSearchState & {
  /** Stream index of the opening delimiter whose pair is being balanced, or -1 */
  pairStart: number;
  /** Number of opening delimiters currently awaiting a closing delimiter */
  nestingLevel: number;
};

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
 * A pair still unbalanced `maxBufferLength` code units after its opening
 * delimiter passes through as text up to there, and the search restarts after
 * it. See [Buffer limit](../../../docs/search-strategies.md#buffer-limit).
 *
 * See [README](./README.md) for the algorithm.
 *
 * @throws If `opening` or `closing` is an empty string.
 * @throws {RangeError} If `maxBufferLength` is not a whole number of at least the
 * opening and closing's total length, the shortest possible match. `Infinity`
 * is allowed; `undefined` selects the default.
 *
 * @example
 * ```typescript
 * import { BalancedPairSearchStrategy, SerialTransformEngine } from 'replace-content-transformer';
 *
 * const engine = new SerialTransformEngine({
 *   searchStrategy: new BalancedPairSearchStrategy('{{', '}}'),
 *   replacement: (match) => match.toUpperCase()
 * });
 * ```
 */
export class BalancedPairSearchStrategy implements SearchStrategy<BalancedPairSearchState> {
  private readonly anchorStrategy: LoopedIndexOfAnchoredSearchStrategy;
  private readonly opening: string;

  /**
   * @param opening - String that opens a pair. Each occurrence inside a match increases the nesting level.
   * @param closing - String that closes a pair. The match ends at the closing string that returns the nesting level to zero.
   * @param options - The ceiling on held-back content. See {@link BufferGuardOptions}.
   */
  constructor(opening: string, closing: string, options?: BufferGuardOptions) {
    this.opening = opening;
    const anchorOptions: AnchorOptions<BalancedPairSearchState> = {
      ...options,
      [acceptMatch]: (state, pairStart, searched) => this.isBalanced(state, pairStart, searched)
    };
    this.anchorStrategy = new LoopedIndexOfAnchoredSearchStrategy([opening, closing], anchorOptions);
  }

  createState(): BalancedPairSearchState {
    return { ...this.anchorStrategy.createState(), pairStart: -1, nestingLevel: 0 };
  }

  processChunk(haystack: string, state: BalancedPairSearchState, sink: MatchSink): undefined {
    this.anchorStrategy.processChunk(haystack, state, sink);
  }

  flush(state: BalancedPairSearchState): string {
    state.pairStart = -1;
    state.nestingLevel = 0;
    return this.anchorStrategy.flush(state);
  }

  matchToString(match: string): string {
    return match;
  }

  protected countOpenings(content: string): number {
    const opening = this.opening;
    let count = 0;
    let cursor = 0;
    while ((cursor = content.indexOf(opening, cursor)) !== -1) {
      count++;
      cursor += opening.length;
    }
    return count;
  }

  private isBalanced(state: BalancedPairSearchState, pairStart: number, searched: string): boolean {
    if (state.pairStart !== pairStart) {
      state.pairStart = pairStart;
      state.nestingLevel = 1;
    }
    state.nestingLevel += this.countOpenings(searched) - 1;
    return state.nestingLevel === 0;
  }
}
