import type { SearchStrategy, MatchResult } from "../../types.ts";
import KMP from "./knuth-morris-pratt.ts";
import StringBufferStrategyBase from "../../string-buffer-strategy-base.ts";

export interface IndexOfKnuthMorrisPrattSearchState {
  needleIndex: number;
  buffer: string;
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

  *processChunk(
    haystack: string,
    state: IndexOfKnuthMorrisPrattSearchState
  ): Generator<MatchResult, void, undefined> {
    try {
      if (state.needleIndex) {
        const needlePossibleWithinHaystack = this.needle.slice(
          state.needleIndex,
          state.needleIndex + haystack.length
        );
        const length = needlePossibleWithinHaystack.length;
        if (needlePossibleWithinHaystack === haystack.slice(0, length)) {
          state.buffer += haystack.slice(0, length);
          haystack = haystack.slice(length);
          state.needleIndex = (state.needleIndex + length) % this.needle.length;

          if (state.needleIndex === 0) {
            const content = state.buffer;
            state.buffer = "";
            yield { content, match: true };
          }
        } else {
          haystack = state.buffer + haystack;
        }
      }

      while (haystack) {
        const matchPos = haystack.indexOf(this.needle);
        if (matchPos === -1) {
          const partialLength = this.KMP.getLengthOfSuffixMatch(haystack);
          if (partialLength) {
            const content = haystack.slice(0, -partialLength);
            if (content) {
              yield { content, match: false };
            }
            state.buffer = haystack.slice(-partialLength);
            state.needleIndex = partialLength;
          } else {
            yield { content: haystack, match: false };
          }
          haystack = "";
          return;
        }

        const content = haystack.slice(0, matchPos);
        if (content) {
          yield { content, match: false };
        }

        haystack = haystack.slice(matchPos + this.needle.length);
        state.buffer = "";
        yield {
          content: this.needle,
          match: true
        };
      }
    } finally {
      if (haystack) {
        state.buffer += haystack;
      }
    }
  }
}
