import type { MatchResult } from "../types.js";
import nonMatch from "./non-match.js";
import type { ScanCursor } from "./types.js";

const MAX_SINGLE_CODE_UNIT_CODE_POINT = 0xffff;

function codeUnitsInCodePointAt(haystack: string, position: number): number {
  const codePoint = haystack.codePointAt(position) ?? 0;
  return codePoint > MAX_SINGLE_CODE_UNIT_CODE_POINT ? 2 : 1;
}

export default function skipOneCodePointPastZeroLengthMatch(
  haystack: string,
  cursor: ScanCursor,
  matchIndex: number
): MatchResult<RegExpExecArray> {
  const skippedFrom = cursor.reportedUpTo;
  const skippedAt = skippedFrom + matchIndex;
  cursor.reportedUpTo = Math.min(
    skippedAt + codeUnitsInCodePointAt(haystack, skippedAt),
    haystack.length
  );
  return nonMatch(haystack.slice(skippedFrom, cursor.reportedUpTo));
}
