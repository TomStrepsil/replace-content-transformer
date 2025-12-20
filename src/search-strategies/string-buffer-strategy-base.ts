export type StringBufferState = {
  buffer: string;
};

abstract class StringBufferStrategyBase {
  createState(): StringBufferState {
    return { buffer: "" };
  }
  flush(state: StringBufferState): string {
    const flushed = state.buffer;
    state.buffer = "";
    return flushed;
  }
}

export default StringBufferStrategyBase;
