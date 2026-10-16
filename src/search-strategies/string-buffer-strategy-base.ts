import type { StringBufferState } from "./types.js";

abstract class StringBufferStrategyBase<TMatch = string> {
  createState(): StringBufferState {
    return { buffer: "", streamOffset: 0 };
  }
  flush(state: StringBufferState): string {
    const flushed = state.buffer;
    state.buffer = "";
    state.streamOffset = 0;
    return flushed;
  }
  matchToString(match: TMatch): string {
    return String(match);
  }
}

export default StringBufferStrategyBase;
