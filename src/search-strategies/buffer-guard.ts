import type { BufferGuardOptions } from "./types.js";

const DEFAULT_MAX_BUFFER_LENGTH = 65_536;

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
  maxBufferLength = DEFAULT_MAX_BUFFER_LENGTH,
  onGuardExceeded
}: BufferGuardOptions = {}): BufferGuard {
  validateAtLeast("maxBufferLength", maxBufferLength, 0);
  return { maxBufferLength, onGuardExceeded };
}
