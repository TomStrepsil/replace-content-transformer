import {
  LoopedIndexOfAnchoredSearchState,
  LoopedIndexOfAnchoredSearchStrategy
} from "../looped-indexOf-anchored/search-strategy.js";
import type {
  BufferGuardOptions,
  MatchSink,
  SearchStrategy,
  StreamIndices
} from "../types.js";

/** Per-stream state for {@link BalancedPairSearchStrategy}. */
export interface BalancedPairSearchState extends LoopedIndexOfAnchoredSearchState {
  /** Number of opening delimiters currently awaiting a closing delimiter. */
  nestingLevel: number;
  /** Counts nesting in the anchor strategy's results before reporting them on. One per stream. */
  nestingSink: NestingSink;
}

class NestingSink implements MatchSink {
  readonly #countOpenings: (content: string) => number;
  #outer!: MatchSink;
  #state!: BalancedPairSearchState;
  #countedLength = 0;

  constructor(countOpenings: (content: string) => number) {
    this.#countOpenings = countOpenings;
  }

  reportTo(outer: MatchSink, state: BalancedPairSearchState): this {
    this.#outer = outer;
    this.#state = state;
    this.#countedLength = state.nestingLevel > 0 ? state.matchConsumedLength : 0;
    return this;
  }

  reportText(content: string): void {
    this.#state.nestingLevel = 0;
    this.#countedLength = 0;
    this.#outer.reportText(content);
  }

  reportMatch(match: string, streamIndices: StreamIndices): boolean {
    const state = this.#state;
    state.nestingLevel += this.#countOpenings(match.slice(this.#countedLength)) - 1;
    if (state.nestingLevel > 0) {
      this.#countedLength = match.length;
      state.currentNeedleIndex = 1;
      return true;
    }
    this.#countedLength = 0;
    return this.#outer.reportMatch(match, streamIndices);
  }
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
 * A pair still unbalanced `maxBufferLength` code units after its opening
 * delimiter passes through as text up to there, and the search restarts after
 * it. See [Buffer limit](../../../README.md#buffer-limit).
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
   * @param options - The ceiling on held-back content. See {@link BufferGuardOptions}.
   */
  constructor(opening: string, closing: string, options?: BufferGuardOptions) {
    this.opening = opening;
    this.anchorStringSearchStrategy = new LoopedIndexOfAnchoredSearchStrategy(
      [opening, closing],
      options
    );
  }

  createState(): BalancedPairSearchState {
    return {
      ...this.anchorStringSearchStrategy.createState(),
      nestingLevel: 0,
      nestingSink: new NestingSink((content) => this.countOpenings(content))
    };
  }

  processChunk(
    haystack: string,
    state: BalancedPairSearchState,
    sink: MatchSink
  ): undefined {
    this.anchorStringSearchStrategy.processChunk(
      haystack,
      state,
      state.nestingSink.reportTo(sink, state)
    );
  }

  flush(state: BalancedPairSearchState): string {
    state.nestingLevel = 0;
    return this.anchorStringSearchStrategy.flush(state);
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
}
