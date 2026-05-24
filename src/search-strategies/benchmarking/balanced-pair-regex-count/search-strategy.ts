import {
  LoopedIndexOfAnchoredSearchStrategy
} from "../../looped-indexOf-anchored/search-strategy";
import type { BalancedPairSearchState } from "../../balanced-pair/search-strategy";
import type { MatchResult, SearchStrategy } from "../../types";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Variant of BalancedPairSearchStrategy that counts opening delimiters using
 * a pre-compiled RegExp + String.match() instead of a while/indexOf loop.
 * Exists only for benchmarking — not part of the public API.
 */
export class BalancedPairRegexCountSearchStrategy implements SearchStrategy<
  BalancedPairSearchState,
  string
> {
  private anchorStringSearchStrategy: LoopedIndexOfAnchoredSearchStrategy;
  private readonly opening: string;
  private readonly openingRegex: RegExp;

  constructor(opening: string, closing: string) {
    this.opening = opening;
    this.openingRegex = new RegExp(escapeRegExp(opening), "g");
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
      state.nestingLevel += newContent.match(this.openingRegex)?.length ?? 0;

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

  flush(state: BalancedPairSearchState): string {
    const flushed = state.balancedBuffer;
    state.balancedBuffer = "";
    state.balancedBufferStart = 0;
    state.nestingLevel = 0;
    return flushed + this.anchorStringSearchStrategy.flush(state);
  }

  matchToString(match: string): string {
    return match;
  }
}
