import type { MatchResult, SearchStrategy } from "../../types.ts";
import StringBufferStrategyBase from "../../string-buffer-strategy-base.ts";

export type BufferedIndexOfCancellableSearchState = {
  buffer: string;
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

  *processChunk(
    haystack: string,
    state: BufferedIndexOfCancellableSearchState
  ): Generator<MatchResult, void, undefined> {
    let candidate = state.buffer + haystack;
    try {
      while (candidate) {
        const index = candidate.indexOf(this.needle);
        if (index === -1) {
          const endPortion = 1 - this.needle.length;
          state.buffer = candidate.slice(endPortion);
          const content = candidate.slice(0, endPortion);
          candidate = "";
          if (content) {
            yield { content, match: false };
          }
          return;
        }

        if (index > 0) {
          yield { content: candidate.slice(0, index), match: false };
        }

        const content = candidate.slice(index, index + this.needle.length);
        candidate = candidate.slice(index + this.needle.length);
        state.buffer = "";
        yield { content, match: true };
      }
    } finally {
      if (candidate) {
        state.buffer = candidate;
      }
    }
  }
}
