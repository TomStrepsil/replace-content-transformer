import type { MatchResult, SearchStrategy } from "../../types.ts";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../../string-buffer-strategy-base.ts";

export interface AnchorSequenceSearchState<TState> extends StringBufferState {
  currentNeedleIndex: number;
  strategyStates: TState[];
}

function extractMatchContent<TMatch>(match: TMatch): string {
  if (Array.isArray(match)) {
    return match[0];
  }
  return String(match);
}

export class AnchorSequenceSearchStrategy<TState, TMatch = string>
  extends StringBufferStrategyBase
  implements SearchStrategy<AnchorSequenceSearchState<TState>, string>
{
  private readonly subStrategies: SearchStrategy<TState, TMatch>[];

  constructor(subStrategies: SearchStrategy<TState, TMatch>[]) {
    super();
    this.subStrategies = subStrategies;
  }

  createState(): AnchorSequenceSearchState<TState> {
    return {
      ...super.createState(),
      currentNeedleIndex: 0,
      strategyStates: this.subStrategies.map((strategy) =>
        strategy.createState()
      )
    };
  }

  *processChunk(
    haystack: string,
    state: AnchorSequenceSearchState<TState>
  ): Generator<MatchResult, void, undefined> {
    const inputLength = haystack.length;
    let isMidMatch = state.currentNeedleIndex !== 0;
    try {
      while (haystack) {
        const subStrategy = this.subStrategies[state.currentNeedleIndex];
        const subStrategyState = state.strategyStates[state.currentNeedleIndex];
        let matched: string | null = null;
        for (const matchResult of subStrategy.processChunk(
          haystack,
          subStrategyState
        )) {
          if (matchResult.isMatch) {
            matched = extractMatchContent(matchResult.content);
            break;
          }
          if (isMidMatch) {
            state.buffer += matchResult.content;
            continue;
          }
          yield matchResult;
        }
        if (!matched) {
          haystack = "";
          return;
        }
        state.buffer += matched;
        haystack = subStrategy.flush(subStrategyState);
        state.strategyStates[state.currentNeedleIndex] =
          subStrategy.createState();

        state.currentNeedleIndex =
          (state.currentNeedleIndex + 1) % this.subStrategies.length;
        isMidMatch = state.currentNeedleIndex !== 0;
        if (!isMidMatch) {
          const match = state.buffer;
          const endIndex = state.streamOffset + inputLength - haystack.length;
          const startIndex = endIndex - match.length;
          state.buffer = "";
          yield { isMatch: true, content: match, streamIndices: [startIndex, endIndex] };
        }
      }
    } finally {
      if (haystack) {
        state.buffer += haystack;
      }
      state.streamOffset += inputLength;
    }
  }

  flush(state: AnchorSequenceSearchState<TState>): string {
    return (
      super.flush(state) +
      this.subStrategies[state.currentNeedleIndex].flush(
        state.strategyStates[state.currentNeedleIndex]
      )
    );
  }
}
