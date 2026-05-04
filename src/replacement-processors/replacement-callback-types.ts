
import type { StreamIndices } from "../search-strategies/types.ts";

/**
 * Shared callback arguments passed to replacement functions.
 */
export type ReplacementCallbackArgs<TMatch> = [
  match: TMatch,
  matchIndex: number,
  streamIndices: StreamIndices
];
