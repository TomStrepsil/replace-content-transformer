import type { MatchSink, SearchStrategy } from "../../../../../src/search-strategies/types.ts";
import StringBufferStrategyBase from "../../../../../src/search-strategies/string-buffer-strategy-base.ts";

export type BufferedIndexOfCancellableSearchState = {
  buffer: string;
  streamOffset: number;
};

export class BufferedIndexOfCancellableSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<BufferedIndexOfCancellableSearchState>
{
  private readonly needle: string;

  constructor(needle: string) {
    super();
    this.needle = needle;
  }

  processChunk(haystack: string, state: BufferedIndexOfCancellableSearchState, sink: MatchSink): undefined {
    const inputLength = haystack.length;
    const bufferLength = state.buffer.length;
    const baseOffset = state.streamOffset - bufferLength;
    let candidate = state.buffer + haystack;
    let candidateOffset = 0;
    try {
      while (candidate) {
        const index = candidate.indexOf(this.needle);
        if (index === -1) {
          const endPortion = 1 - this.needle.length;
          state.buffer = candidate.slice(endPortion);
          const nonMatch = candidate.slice(0, endPortion);
          candidate = "";
          if (nonMatch) {
            sink.reportText(nonMatch);
          }
          return;
        }

        if (index > 0) {
          sink.reportText(candidate.slice(0, index));
        }

        const startIndex = baseOffset + candidateOffset + index;
        const endIndex = startIndex + this.needle.length;
        candidateOffset += index + this.needle.length;
        const match = candidate.slice(index, index + this.needle.length);
        candidate = candidate.slice(index + this.needle.length);
        state.buffer = "";
        if (!sink.reportMatch(match, [startIndex, endIndex])) return;
      }
    } finally {
      if (candidate) {
        state.buffer = candidate;
      }
      state.streamOffset += inputLength;
    }
  }
}
