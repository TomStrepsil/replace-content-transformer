import type { DEFAULT_OPTIONS } from "./default-options.js";
import type { StringBufferState } from "../types.js";

/** Per-stream state for `RegexSearchStrategy`. */
export type RegexSearchState = StringBufferState & {
  /** Buffer length, in code units, at the last scan of the held-back content. */
  evaluatedBufferLength: number;
};

/** Passed to `onGuardExceeded` when held-back content exceeds `maxBufferLength`. */
export type GuardExceededInfo = {
  /** Length, in code units, of the content that was settled early. */
  bufferLength: number;
};

export type ScanCursor = { reportedUpTo: number };

export type RegexSearchStrategyOptions = Partial<typeof DEFAULT_OPTIONS> & {
  /** Called when `maxBufferLength` is exceeded and the buffer is settled early. */
  onGuardExceeded?: (info: GuardExceededInfo) => void;
};
