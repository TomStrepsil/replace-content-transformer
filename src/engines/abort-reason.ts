type PossiblyWrapped = { cause?: unknown };

export function failedWithReasonOf(signal: AbortSignal | undefined, error: unknown): boolean {
  if (signal?.aborted !== true) return false;
  const { reason } = signal;
  const seen = new Set<unknown>();
  for (let current = error; current !== reason; current = (current as PossiblyWrapped).cause) {
    if (current == null || seen.has(current)) return false;
    seen.add(current);
  }
  return true;
}
