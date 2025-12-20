import type { SearchStrategy, MatchResult } from "../../types.ts";
import StringBufferStrategyBase from "../../string-buffer-strategy-base.ts";
export interface LoopedIndexOfCancellableSearchState {
  needleIndex: number;
  buffer: string;
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

  *processChunk(
    haystack: string,
    state: LoopedIndexOfCancellableSearchState
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
          const content = haystack;
          haystack = "";
          for (
            let partialLength = this.needle.length - 1;
            partialLength >= 1;
            partialLength--
          ) {
            const haystackSuffix = content.slice(-partialLength);
            const needlePrefix = this.needle.slice(0, partialLength);
            if (haystackSuffix === needlePrefix) {
              yield {
                content: content.slice(0, -partialLength),
                match: false
              };
              state.buffer = content.slice(-partialLength);
              state.needleIndex = partialLength;
              return;
            }
          }
          yield { content, match: false };

          return;
        }

        yield { content: haystack.slice(0, matchPos), match: false };
        haystack = haystack.slice(matchPos + this.needle.length);
        state.buffer = "";
        yield {
          content: this.needle,
          match: true
        };
      }
    } finally {
      if (haystack) {
        state.buffer = haystack;
      }
    }
  }
}
