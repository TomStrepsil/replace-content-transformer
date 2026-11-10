import type { StreamIndices } from "../types.js";
import type { ScanCursor } from "./types.js";
import updateIndices from "./update-indices.js";

export default function takeMatch(
  match: RegExpExecArray,
  cursor: ScanCursor,
  baseOffset: number
): StreamIndices {
  const matchStart = cursor.reportedUpTo;
  cursor.reportedUpTo = matchStart + match[0].length;
  const startIndex = baseOffset + matchStart;
  const indices = match.indices;
  if (indices) updateIndices(indices, startIndex - match.index);
  match.index = startIndex;
  delete (match as Partial<RegExpExecArray>).input;
  return [startIndex, startIndex + match[0].length];
}
