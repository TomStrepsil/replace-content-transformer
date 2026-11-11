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
 * Receives a search strategy's results, in stream order.
 *
 * @template TMatch - The type of match reported by the strategy (default: string)
 */
export interface MatchSink<TMatch = string> {
  /** Report literal content, to be emitted as-is. */
  reportText(content: string): void;
  /**
   * Report a match.
   *
   * @param content - Match value passed to the replacement function
   * @param streamIndices - Stream offsets of the match; `endIndex` is exclusive
   * @returns `false` to stop: the strategy returns at once, leaving everything after this
   * match in `state`. Once the strategy has returned, {@link SearchStrategy.flush | flush}
   * returns it as raw text, or the same scan carries on when called again with no new input.
   * Neither may be called from within the sink.
   */
  reportMatch(content: TMatch, streamIndices: StreamIndices): boolean;
}

/**
 * Search strategy for finding patterns in streaming content.
 *
 * Strategies are stateless and reusable across multiple streams, hence state is owned by the engine.
 *
 * @template TState - The type of state this strategy requires (use void for stateless strategies)
 * @template TMatch - The type of match reported by the strategy (default: string)
 */
export interface SearchStrategy<TState, TMatch = string> {
  /**
   * Create initial state for this strategy.
   * Called once per engine.
   */
  createState(): TState;

  /**
   * Process an input chunk, reporting results to `sink` as they're determined.
   *
   * Stops early when {@link MatchSink.reportMatch} returns `false`. Calling it again with `""`
   * carries on from that match.
   *
   * @param haystack - New content to process
   * @param state - Mutable state object to track search progress
   * @param sink - Receives literal content and matches, in stream order
   */
  processChunk(haystack: string, state: TState, sink: MatchSink<TMatch>): undefined;

  /**
   * Return everything held in `state` as raw text, without searching it, and re-set `state`
   * for re-use.
   *
   * Engines call this at end of stream when there is no {@link settle}, and in place of
   * {@link settle} once `stopReplacingSignal` has aborted.
   *
   * @param state - Mutable state
   * @returns The held text, or `""` when nothing is held
   */
  flush(state: TState): string;

  /**
   * Optional. Decide whatever remains held in `state`, now that no further input can arrive,
   * and re-set `state` when it completes.
   *
   * Reports to `sink` as {@link processChunk} does, so a strategy that deferred a decision
   * at a chunk boundary can still report a real match once the stream ends. A strategy
   * without it has its held text emitted verbatim via {@link flush}.
   *
   * Stops early when {@link MatchSink.reportMatch} returns `false`. Calling it again carries on
   * from that match; {@link flush} returns the rest as raw text instead.
   *
   * @param state - Mutable state
   * @param sink - Receives literal content and matches, in stream order
   */
  settle?(state: TState, sink: MatchSink<TMatch>): undefined;

  /**
   * Convert a match value to the raw matched string.
   *
   * Used when a match must be emitted verbatim (e.g. when
   * {@link AsyncLookaheadTransformEngineOptions.abandonPendingSignal} fires).
   * For string-based strategies this is the identity function; for richer
   * match types (e.g. `StreamRegexMatch`) implementations should return the
   * full matched text (`match[0]`).
   */
  matchToString(match: TMatch): string;
}

/** A ceiling on the content a search strategy holds back awaiting a decision. */
export type BufferGuardOptions = {
  /**
   * Longest span, as a whole number of UTF-16 code units, held back awaiting a
   * decision.
   * `Infinity` removes the ceiling. For the string strategies, it must be at
   * least the anchors' total length, the shortest possible match.
   * @default 65536
   */
  maxBufferLength?: number;
  /** Called each time a match still incomplete `maxBufferLength` code units after its start passes through as text up to there. */
  onGuardExceeded?: () => void;
};

export type StringBufferState = {
  buffer: string;
  streamOffset: number;
};
