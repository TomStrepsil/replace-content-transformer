/**
 * Result of processing content - either a match or literal content
 */
export interface MatchResult {
  content: string;
  match: boolean;
}

/**
 * Search strategy for finding patterns in streaming content.
 *
 * Strategies are stateless and reusable across multiple streams, hence state is owned by the consuming processor.
 *
 * @template TState - The type of state this strategy requires (use void for stateless strategies)
 */
export interface SearchStrategy<TState> {
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
   * @yields MatchResult - Content chunks ready for output
   */
  processChunk(
    haystack: string,
    state: TState
  ): Generator<MatchResult, void, undefined>;

  /**
   * Flush any partial match content buffered in state.
   *
   * @param state - Mutable state
   * @returns Remaining buffered content (empty string if nothing buffered)
   */
  flush(state: TState): string;
}
