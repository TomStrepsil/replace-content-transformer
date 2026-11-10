import type { MatchResult } from "../../../../search-strategy-results.ts";

export interface GeneratorSearchStrategy<TState, TMatch = string> {
  createState(): TState;
  processChunk(
    haystack: string,
    state: TState
  ): Generator<MatchResult<TMatch>, void, undefined>;
  flush(state: TState): string;
}
