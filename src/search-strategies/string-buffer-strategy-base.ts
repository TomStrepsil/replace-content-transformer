import type { MatchResult, StringBufferState } from "./types.js";

abstract class StringBufferStrategyBase<TMatch = string> {
  createState(): StringBufferState {
    return { buffer: "", streamOffset: 0 };
  }
  *flush(
    state: StringBufferState
  ): Generator<MatchResult<TMatch>, void, undefined> {
    const flushed = state.buffer;
    state.buffer = "";
    state.streamOffset = 0;
    if (flushed) yield { isMatch: false, content: flushed };
  }
  matchToString(match: TMatch): string {
    return String(match);
  }
}

export default StringBufferStrategyBase;
