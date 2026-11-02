import type { DEFAULT_OPTIONS } from "./default-options.js";
import type { BufferGuardOptions, StringBufferState } from "../types.js";

/** A stream-relative regex match without RegExpExecArray.input, which identifies only one scan buffer. */
export type StreamRegexMatch = Omit<RegExpExecArray, "input">;

/** Per-stream state for `RegexSearchStrategy`. */
export type RegexSearchState = StringBufferState & {
  /** Length, in code units, of the candidate held back at the last scan. */
  evaluatedBufferLength: number;
};

export type ScanCursor = { reportedUpTo: number };

/**
 * Held-back content past `maxBufferLength` is settled with the original pattern,
 * as at end of stream.
 */
export type RegexSearchStrategyOptions = Partial<typeof DEFAULT_OPTIONS> &
  BufferGuardOptions;
