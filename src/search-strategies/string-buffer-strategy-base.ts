export type StringBufferState = {
  buffer: string;
  streamOffset: number;
};

abstract class StringBufferStrategyBase {
  createState(): StringBufferState {
    return { buffer: "", streamOffset: 0 };
  }
  flush(state: StringBufferState): string {
    const flushed = state.buffer;
    state.buffer = "";
    return flushed;
  }
}

export default StringBufferStrategyBase;
