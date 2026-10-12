import type { DEFAULT_OPTIONS } from "./default-options.js";
import type { StreamIndices, StringBufferState } from "../types.js";

/** A streamed regex match; no single input string represents a match across chunks. */
export type StreamRegexMatch = Omit<RegExpExecArray, "input">;

/** Per-stream state for `RegexSearchStrategy`. */
export type RegexSearchState = StringBufferState & {
  /** Buffer length, in code units, at the last scan of the held-back content. */
  evaluatedBufferLength: number;
};

/** Passed to `onGuardExceeded` when held-back content exceeds `maxBufferLength`. */
export type GuardExceededInfo = {
  /**
   * Absolute stream offsets, as [startIndex, endIndex] with endIndex exclusive,
   * of the held-back content that is settled early.
   */
  streamIndices: StreamIndices;
};

export type ScanCursor = { reportedUpTo: number };

export type RegexSearchStrategyOptions = Partial<typeof DEFAULT_OPTIONS> & {
  /** Called when `maxBufferLength` is exceeded and the buffer is settled early. */
  onGuardExceeded?: (info: GuardExceededInfo) => void;
};
