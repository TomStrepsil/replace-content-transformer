import type { ScanCursor } from "./types.js";

export default function advanceToMatch(
  match: RegExpExecArray,
  haystack: string,
  cursor: ScanCursor
): string {
  const precedingContentFrom = cursor.reportedUpTo;
  cursor.reportedUpTo = precedingContentFrom + match.index;
  return haystack.slice(precedingContentFrom, cursor.reportedUpTo);
}
