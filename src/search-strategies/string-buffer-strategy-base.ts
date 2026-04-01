export type StringBufferState = {
  buffer: string;
};

export function createStringBufferState(): StringBufferState {
  return { buffer: "" };
}

export function flushStringBuffer(state: StringBufferState): string {
  const flushed = state.buffer;
  state.buffer = "";
  return flushed;
}

/**
 * @deprecated Extend from helper functions instead.
 */
abstract class StringBufferStrategyBase {
  createState(): StringBufferState {
    return createStringBufferState();
  }
  flush(state: StringBufferState): string {
    return flushStringBuffer(state);
  }
}

export default StringBufferStrategyBase;
