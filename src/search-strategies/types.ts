/**
 * Result of processing content - either a match or literal content.
 *
 * Uses boolean discrimination with typed content:
 * - `{ isMatch: false, content: string }` - Literal content to yield as-is
 * - `{ isMatch: true, content: T, startIndex: number, endIndex: number }` - Match value passed to replacement function
 *
 * @typeParam T - The type of value returned for matches (default: string)
 */
export type MatchResult<T = string> =
  | { isMatch: false; content: string }
  | { isMatch: true; content: T; startIndex: number; endIndex: number };

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
   * @yields MatchResult - Either `{ isMatch: false, content: string }` or `{ isMatch: true, content: TMatch }`
   */
  processChunk(
    haystack: string,
    state: TState
  ): Generator<MatchResult<TMatch>, void, undefined>;

  /**
   * Flush any partial match content buffered in state.
   *
   * @param state - Mutable state
   * @returns Remaining buffered content (empty string if nothing buffered)
   */
  flush(state: TState): string;
}
