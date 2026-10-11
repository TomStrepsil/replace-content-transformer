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
  // The match is reported with stream-relative positions: index is the offset into the
  // whole stream (equal to indices[0] when "d" is used), and the chunk it was found in
  // is not handed out as input. Both are changed in place, so no copy is made.
  match.index = startIndex;
  delete (match as Partial<RegExpExecArray>).input;
  return {
    isMatch: true,
    content: match,
    streamIndices: [startIndex, startIndex + match[0].length]
  };
}
