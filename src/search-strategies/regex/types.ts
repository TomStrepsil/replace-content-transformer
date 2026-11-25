import type { DEFAULT_OPTIONS } from "./default-options.js";
import type { BufferGuardOptions } from "../types.js";
import type HeldText from "../held-text.js";

/** A stream-relative regex match. The strategy sets `input` to `undefined`, since a native `input` identifies only one scan buffer. */
export type StreamRegexMatch = Omit<RegExpExecArray, "input"> & { input: undefined };

/** Per-stream state for `RegexSearchStrategy`. */
export type RegexSearchState = {
  /** Content received but not yet reported, and its position in the stream. */
  held: Readonly<HeldText<StreamRegexMatch>>;
  /** Buffer length, in code units, at the last scan of the held-back content. */
  evaluatedBufferLength: number;
};

/**
 * A candidate still unresolved `maxBufferLength` code units after its start passes
 * through as text up to there, and the search restarts after it.
 */
export type RegexSearchStrategyOptions = Partial<typeof DEFAULT_OPTIONS> &
  BufferGuardOptions;
