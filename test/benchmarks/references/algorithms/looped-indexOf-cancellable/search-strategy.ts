import type { SearchStrategy, MatchSink, StringBufferState } from "../../../../../src/search-strategies/types.ts";
import StringBufferStrategyBase from "../../../../../src/search-strategies/string-buffer-strategy-base.ts";

export interface LoopedIndexOfCancellableSearchState extends StringBufferState {
  needleIndex: number;
}

export class LoopedIndexOfCancellableSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<LoopedIndexOfCancellableSearchState>
{
  private readonly needle: string;

  constructor(needle: string) {
    super();
    this.needle = needle;
  }

  createState(): LoopedIndexOfCancellableSearchState {
    return { ...super.createState(), needleIndex: 0 };
  }

  processChunk(haystack: string, state: LoopedIndexOfCancellableSearchState, sink: MatchSink): undefined {
    const inputLength = haystack.length;
    let absoluteCursor = state.streamOffset;
    try {
      if (state.needleIndex) {
        const bufferLength = state.buffer.length;
        const matchStart = absoluteCursor - bufferLength;
        const needlePossibleWithinHaystack = this.needle.slice(
          state.needleIndex,
          state.needleIndex + haystack.length
        );
        const length = needlePossibleWithinHaystack.length;
        if (needlePossibleWithinHaystack === haystack.slice(0, length)) {
          state.buffer += haystack.slice(0, length);
          haystack = haystack.slice(length);
          absoluteCursor += length;
          state.needleIndex = (state.needleIndex + length) % this.needle.length;

          if (state.needleIndex === 0) {
            const match = state.buffer;
            state.buffer = "";
            if (!sink.reportMatch(match, [matchStart, matchStart + this.needle.length])) return;
          }
        } else {
          haystack = state.buffer + haystack;
          absoluteCursor -= bufferLength;
        }
      } else {
        haystack = state.buffer + haystack;
        absoluteCursor -= state.buffer.length;
        state.buffer = "";
      }

      while (haystack) {
        const matchPos = haystack.indexOf(this.needle);
        if (matchPos === -1) {
          const nonMatch = haystack;
          haystack = "";
          for (
            let partialLength = this.needle.length - 1;
            partialLength >= 1;
            partialLength--
          ) {
            const haystackSuffix = nonMatch.slice(-partialLength);
            const needlePrefix = this.needle.slice(0, partialLength);
            if (haystackSuffix === needlePrefix) {
              const unmatched = nonMatch.slice(0, -partialLength);
              if (unmatched) sink.reportText(unmatched);
              state.buffer = nonMatch.slice(-partialLength);
              state.needleIndex = partialLength;
              return;
            }
          }
          sink.reportText(nonMatch);
          return;
        }

        if (matchPos) {
          sink.reportText(haystack.slice(0, matchPos));
        }
        const startIndex = absoluteCursor + matchPos;
        const endIndex = startIndex + this.needle.length;
        absoluteCursor += matchPos + this.needle.length;
        haystack = haystack.slice(matchPos + this.needle.length);
        state.buffer = "";
        if (!sink.reportMatch(this.needle, [startIndex, endIndex])) return;
      }
    } finally {
      if (haystack) {
        state.buffer = haystack;
      }
      state.streamOffset += inputLength;
    }
  }

  flush(state: LoopedIndexOfCancellableSearchState): string {
    state.needleIndex = 0;
    return super.flush(state);
  }
}
