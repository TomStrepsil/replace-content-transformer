import type { ScanCursor } from "./types.js";
import codeUnitsInCodePointAt from "../code-units-in-code-point-at.js";

export default function skipOneCodePointPastZeroLengthMatch(
  haystack: string,
  cursor: ScanCursor,
  matchIndex: number
): string {
  const skippedFrom = cursor.reportedUpTo;
  const skippedAt = skippedFrom + matchIndex;
  cursor.reportedUpTo = Math.min(
    skippedAt + codeUnitsInCodePointAt(haystack, skippedAt),
    haystack.length
  );
  return haystack.slice(skippedFrom, cursor.reportedUpTo);
}
