import type { MatchResult } from "../types.js";

export default function nonMatch(content: string): MatchResult<RegExpExecArray> {
  return { isMatch: false, content };
}
