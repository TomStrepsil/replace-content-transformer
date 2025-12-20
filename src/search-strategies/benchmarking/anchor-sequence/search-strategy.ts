import type { MatchResult, SearchStrategy } from "../../types.ts";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../../string-buffer-strategy-base.ts";
export interface AnchorSequenceSearchState<TState> extends StringBufferState {
  currentNeedleIndex: number;
  strategyStates: TState[];
}

/**
 * Search strategy for delimiter token patterns.
 * Matches content between sequential delimiter tokens, e.g., ["{{", "}}"] matches "{{name}}"
 * Supports multi-token patterns like ['<img src="', '" alt="', '">']
 * State is externally owned to allow strategy reuse across multiple streams.
 */
export class AnchorSequenceSearchStrategy<TState>
  extends StringBufferStrategyBase
  implements SearchStrategy<AnchorSequenceSearchState<TState>>
{
  private readonly subStrategies: SearchStrategy<TState>[];

  constructor(subStrategies: SearchStrategy<TState>[]) {
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
          if (matchResult.match) {
            matched = matchResult.content;
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
          const content = state.buffer;
          state.buffer = "";
          yield { content, match: true };
        }
      }
    } finally {
      if (haystack) {
        state.buffer += haystack;
      }
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
