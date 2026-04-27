import type { SearchStrategy } from "../search-strategies/types.js";

/**
 * Base options for all replacement processors.
 * Uses separate generics for state and match to preserve type information.
 */
export type ReplacementProcessorOptions<TState, TMatch> = {
  searchStrategy: SearchStrategy<TState, TMatch>;
};

/**
 * Context passed to replacement callbacks.
 *
 * @property matchIndex - Zero-based ordinal for the current match in the stream.
 * @property streamIndices - Absolute stream offsets as [startIndex, endIndex], where endIndex is exclusive.
 */
export type ReplacementContext = {
  matchIndex: number;
  streamIndices: [startIndex: number, endIndex: number];
};

/**
 * Base class for replacement processors.
 * Uses separate generics for state and match to avoid type casts.
 */
export abstract class ReplacementProcessorBase<TState, TMatch> {
  protected readonly searchStrategy: SearchStrategy<TState, TMatch>;
  protected searchState: TState;

  constructor({ searchStrategy }: ReplacementProcessorOptions<TState, TMatch>) {
    this.searchStrategy = searchStrategy;
    this.searchState = searchStrategy.createState();
  }

  flush(): string {
    return this.searchStrategy.flush(this.searchState);
  }
}
