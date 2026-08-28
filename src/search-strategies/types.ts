/**
 * Inclusive/exclusive stream indices for a discovered match.
 *
 * - `startIndex`: index of the first matched character
 * - `endIndex`: index immediately after the last matched character
 */
export type StreamIndices = [
  startIndex: number,
  endIndex: number
];

/**
 * Result of processing content - either a match or literal content.
 *
 * Uses boolean discrimination with typed content:
 * - `{ isMatch: false, content: string }` - Literal content to yield as-is
 * - `{ isMatch: true, content: T, streamIndices: [startIndex, endIndex] }` - Match value passed to replacement function (endIndex is exclusive / half-open interval)
 *
 * @typeParam T - The type of value returned for matches (default: string)
 */
export type MatchResult<T = string> =
  | { isMatch: false; content: string }
  | { isMatch: true; content: T; streamIndices: StreamIndices };

/**
 * Search strategy for finding patterns in streaming content.
 *
 * Strategies are stateless and reusable across multiple streams, hence state is owned by the consuming processor.
 *
 * @template TState - The type of state this strategy requires (use void for stateless strategies)
 * @template TMatch - The type of match returned by the strategy (default: string)
 */
export interface SearchStrategy<TState, TMatch = string> {
  /**
   * Create initial state for this strategy.
   * Called once per stream processor instance.
   */
  createState(): TState;

  /**
   * Process input chunk and yield match results as they're determined.
   *
   * @param haystack - New content to process
   * @param state - Mutable state object to track search progress
   * @yields MatchResult - Either `{ isMatch: false, content: string }` or `{ isMatch: true, content: TMatch, streamIndices: [startIndex, endIndex] }`
   */
  processChunk(
    haystack: string,
    state: TState
  ): Generator<MatchResult<TMatch>, void, undefined>;

  /**
   * Settle whatever remains buffered in state, now that no further input can arrive.
   *
   * Yields the same {@link MatchResult} union as {@link processChunk}, so a strategy
   * that deferred a decision at a chunk boundary can still report a real match once
   * the stream ends. Strategies with nothing to settle yield the buffer as a single
   * non-match result; a strategy holding nothing yields nothing at all.
   *
   * @param state - Mutable state
   * @yields MatchResult - Either `{ isMatch: false, content: string }` or `{ isMatch: true, content: TMatch, streamIndices: [startIndex, endIndex] }`
   */
  flush(state: TState): Generator<MatchResult<TMatch>, void, undefined>;

  /**
   * Convert a match value to the raw matched string.
   *
   * Used when a match must be emitted verbatim (e.g. when
   * {@link AsyncLookaheadTransformEngineOptions.abandonPendingSignal} fires).
   * For string-based strategies this is the identity function; for richer
   * match types (e.g. `RegExpExecArray`) implementations should return the
   * full matched text (`match[0]`).
   */
  matchToString(match: TMatch): string;
}
