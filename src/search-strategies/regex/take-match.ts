import type { MatchResult } from "../types.js";
import type { ScanCursor } from "./types.js";
import updateIndices from "./update-indices.js";

export default function takeMatch(
  match: RegExpExecArray,
  cursor: ScanCursor,
  baseOffset: number
): MatchResult<RegExpExecArray> {
  const matchStart = cursor.reportedUpTo;
  cursor.reportedUpTo = matchStart + match[0].length;
  const startIndex = baseOffset + matchStart;
  const indices = match.indices;
  if (indices) updateIndices(indices, startIndex - match.index);
  return {
    isMatch: true,
    content: match,
    streamIndices: [startIndex, startIndex + match[0].length]
  };
}
