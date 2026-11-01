import type { BufferGuardOptions, MatchResult } from "./types.js";

export const DEFAULT_BUFFER_GUARD = {
  /**
   * Longest span, in UTF-16 code units, held back awaiting a decision. `Infinity`
   * removes the ceiling.
   * @default 65536
   */
  maxBufferLength: 65_536
};

export type BufferGuard = BufferGuardOptions & { maxBufferLength: number };

export const validateAtLeast = (name: string, value: unknown, minimum: number) => {
  if (typeof value !== "number") {
    throw new TypeError(
      `${name} must be a number, received ${value === null ? "null" : typeof value}`
    );
  }
  if (!(value >= minimum)) {
    throw new RangeError(
      `${name} must be a number of at least ${minimum} (or Infinity), received ${String(value)}`
    );
  }
};

export default function bufferGuard({
  maxBufferLength = DEFAULT_BUFFER_GUARD.maxBufferLength,
  onGuardExceeded
}: BufferGuardOptions = {}): BufferGuard {
  validateAtLeast("maxBufferLength", maxBufferLength, 0);
  return { maxBufferLength, onGuardExceeded };
}

export const anchorsFit = (anchors: readonly string[], { maxBufferLength }: BufferGuard) =>
  anchors.reduce((length, anchor) => length + anchor.length, 0) <= maxBufferLength;

export function* passThrough(haystack: string): Generator<MatchResult, void, undefined> {
  if (haystack !== "") yield { isMatch: false, content: haystack };
}
