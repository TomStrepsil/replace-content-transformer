import type { SearchStrategy, MatchSink, StringBufferState } from "../../../../../src/search-strategies/types.ts";
import KMP from "./knuth-morris-pratt.ts";
import StringBufferStrategyBase from "../../../../../src/search-strategies/string-buffer-strategy-base.ts";

export interface IndexOfKnuthMorrisPrattSearchState extends StringBufferState {
  needleIndex: number;
}

export class IndexOfKnuthMorrisPrattSearchStrategy
  extends StringBufferStrategyBase
  implements SearchStrategy<IndexOfKnuthMorrisPrattSearchState>
{
  private needle: string;
  private KMP: KMP;

  constructor(needle: string) {
    super();
    this.needle = needle;
    this.KMP = new KMP(needle);
  }

  createState(): IndexOfKnuthMorrisPrattSearchState {
    return { ...super.createState(), needleIndex: 0 };
  }

  processChunk(haystack: string, state: IndexOfKnuthMorrisPrattSearchState, sink: MatchSink): undefined {
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
          const partialLength = this.KMP.getLengthOfSuffixMatch(haystack);
          if (partialLength) {
            const nonMatch = haystack.slice(0, -partialLength);
            if (nonMatch) {
              sink.reportText(nonMatch);
            }
            state.buffer = haystack.slice(-partialLength);
            state.needleIndex = partialLength;
          } else {
            sink.reportText(haystack);
          }
          haystack = "";
          return;
        }

        const nonMatch = haystack.slice(0, matchPos);
        if (nonMatch) {
          sink.reportText(nonMatch);
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
        state.buffer += haystack;
      }
      state.streamOffset += inputLength;
    }
  }

  flush(state: IndexOfKnuthMorrisPrattSearchState): string {
    state.needleIndex = 0;
    return super.flush(state);
  }
}
