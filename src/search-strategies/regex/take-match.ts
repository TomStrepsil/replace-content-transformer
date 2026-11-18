import type { MatchSink } from "../types.js";
import type { ScanCursor, StreamRegexMatch } from "./types.js";
import updateIndices from "./update-indices.js";

export default function takeMatch(
  match: Omit<RegExpExecArray, "input">,
  cursor: ScanCursor,
  baseOffset: number,
  sink: MatchSink<StreamRegexMatch>
): boolean {
  const matchStart = cursor.reportedUpTo;
  cursor.reportedUpTo = matchStart + match[0].length;
  const startIndex = baseOffset + matchStart;
  const indices = match.indices;
  if (indices) updateIndices(indices, startIndex - match.index);
  const streamMatch = match as StreamRegexMatch;
  streamMatch.index = startIndex;
  streamMatch.input = undefined;
  return sink.reportMatch(streamMatch, [startIndex, startIndex + match[0].length]);
}
