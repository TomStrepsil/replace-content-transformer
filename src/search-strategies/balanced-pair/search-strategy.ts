import {
  LoopedIndexOfAnchoredSearchState,
  LoopedIndexOfAnchoredSearchStrategy
} from "../looped-indexOf-anchored/search-strategy.js";
import type { MatchResult, SearchStrategy } from "../types.js";

export interface BalancedPairSearchState extends LoopedIndexOfAnchoredSearchState {
  nestingLevel: number;
  balancedBuffer: string;
  balancedBufferStart: number;
}

export class BalancedPairSearchStrategy implements SearchStrategy<
  BalancedPairSearchState,
  string
> {
  private anchorStringSearchStrategy: LoopedIndexOfAnchoredSearchStrategy;
  private readonly opening: string;

  constructor(opening: string, closing: string) {
    this.opening = opening;
    this.anchorStringSearchStrategy = new LoopedIndexOfAnchoredSearchStrategy([
      opening,
      closing
    ]);
  }

  createState(): BalancedPairSearchState {
    return {
      ...this.anchorStringSearchStrategy.createState(),
      nestingLevel: 0,
      balancedBuffer: "",
      balancedBufferStart: 0
    };
  }

  *processChunk(
    haystack: string,
    state: BalancedPairSearchState
  ): Generator<MatchResult, void, undefined> {
    let prevMatchLength = 0;
    for (const matchResult of this.anchorStringSearchStrategy.processChunk(
      haystack,
      state
    )) {
      if (!matchResult.isMatch) {
        yield matchResult;
        continue;
      }
      const newContent = matchResult.content.slice(prevMatchLength);
      prevMatchLength = matchResult.content.length;

      if (state.balancedBuffer === "") {
        state.balancedBufferStart = matchResult.streamIndices[0];
      }
      state.balancedBuffer += newContent;
      state.nestingLevel--;
      let cursor = 0;
      while ((cursor = newContent.indexOf(this.opening, cursor)) !== -1) {
        state.nestingLevel++;
        cursor += this.opening.length;
      }

      if (state.nestingLevel > 0) {
        state.currentNeedleIndex = 1;
      } else {
        state.nestingLevel = 0;
        const content = state.balancedBuffer;
        state.balancedBuffer = "";
        prevMatchLength = 0;
        yield {
          isMatch: true,
          content,
          streamIndices: [
            state.balancedBufferStart,
            matchResult.streamIndices[1]
          ]
        };
      }
    }
    if (state.nestingLevel > 0) {
      state.buffer = state.buffer.slice(state.balancedBuffer.length);
    }
  }

  *flush(
    state: BalancedPairSearchState
  ): Generator<MatchResult, void, undefined> {
    const flushed = state.balancedBuffer;
    state.balancedBuffer = "";
    state.balancedBufferStart = 0;
    state.nestingLevel = 0;
    if (flushed) yield { isMatch: false, content: flushed };
    yield* this.anchorStringSearchStrategy.flush(state);
  }

  matchToString(match: string): string {
    return match;
  }
}
