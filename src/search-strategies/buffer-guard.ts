import type { BufferGuardOptions } from "./types.js";
import codeUnitsInCodePointAt from "./code-units-in-code-point-at.js";

export const DEFAULT_MAX_BUFFER_LENGTH = 65_536;

export type BufferGuard = {
  maxBufferLength: number;
  release(haystack: string, start: number): number;
};

export const validateAtLeast = (name: string, value: unknown, minimum: number) => {
  if (typeof value !== "number" || !(value >= minimum)) {
    throw new RangeError(
      `${name} must be a number of at least ${minimum} (or Infinity), received ${String(value)}`
    );
  }
};

export default function bufferGuard({
  maxBufferLength = DEFAULT_MAX_BUFFER_LENGTH,
  onGuardExceeded
}: BufferGuardOptions = {}): BufferGuard {
  validateAtLeast("maxBufferLength", maxBufferLength, 0);
  const releasedLength = Math.max(maxBufferLength, 1);
  return {
    maxBufferLength,
    release(haystack, start) {
      onGuardExceeded?.();
      const lastReleased = start + releasedLength - 1;
      return lastReleased + codeUnitsInCodePointAt(haystack, lastReleased);
    }
  };
}
