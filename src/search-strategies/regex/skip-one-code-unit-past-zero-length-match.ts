import type { MatchResult } from "../types.js";
import nonMatch from "./non-match.js";
import type { ScanCursor } from "./types.js";

export default function skipOneCodeUnitPastZeroLengthMatch(
  haystack: string,
  cursor: ScanCursor,
  matchIndex: number
): MatchResult<RegExpExecArray> {
  const skippedFrom = cursor.reportedUpTo;
  cursor.reportedUpTo = Math.min(skippedFrom + matchIndex + 1, haystack.length);
  return nonMatch(haystack.slice(skippedFrom, cursor.reportedUpTo));
}
