type PossibleAbortError = { cause?: unknown; name?: unknown };

const ABORT_ERROR_NAME = "AbortError";

export function failedFromAbortOf(signal: AbortSignal | undefined, error: unknown): boolean {
  if (signal?.aborted !== true) return false;
  const { reason } = signal;
  const hasReason = reason !== undefined;
  const seen = new Set<unknown>();
  for (let current = error; ; current = (current as PossibleAbortError).cause) {
    if (hasReason && Object.is(current, reason)) return true;
    if (current == null || seen.has(current)) return false;
    if ((current as PossibleAbortError).name === ABORT_ERROR_NAME) return true;
    seen.add(current);
  }
}
