import type { MatchResult } from "../types.js";
import nonMatch from "./non-match.js";
import type { ScanCursor } from "./types.js";

export default function advanceToMatch(
  match: RegExpExecArray,
  haystack: string,
  cursor: ScanCursor
): MatchResult<RegExpExecArray> | null {
  const precedingContentFrom = cursor.reportedUpTo;
  cursor.reportedUpTo = precedingContentFrom + match.index;
  return match.index > 0
    ? nonMatch(haystack.slice(precedingContentFrom, cursor.reportedUpTo))
    : null;
}
