import type { MatchResult, SearchStrategy } from "../../types.ts";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../../string-buffer-strategy-base.ts";

export interface AnchorSequenceSearchState<TState> extends StringBufferState {
  currentNeedleIndex: number;
  strategyStates: TState[];
}

function renderResult<TState, TMatch>(
  subStrategy: SearchStrategy<TState, TMatch>,
  result: MatchResult<TMatch>
): string {
  return result.isMatch
    ? subStrategy.matchToString(result.content)
    : result.content;
}

function drainToString<TState, TMatch>(
  subStrategy: SearchStrategy<TState, TMatch>,
  subStrategyState: TState
): string {
  let buffered = "";
  for (const result of subStrategy.flush(subStrategyState)) {
    buffered += renderResult(subStrategy, result);
  }
  return buffered;
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
            matched = subStrategy.matchToString(matchResult.content);
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
        haystack = drainToString(subStrategy, subStrategyState);
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

  *flush(
    state: AnchorSequenceSearchState<TState>
  ): Generator<MatchResult, void, undefined> {
    const needleIndex = state.currentNeedleIndex;
    const subStrategy = this.subStrategies[needleIndex];
    let matched: string | null = null;
    let tail = "";
    for (const result of subStrategy.flush(state.strategyStates[needleIndex])) {
      const text = renderResult(subStrategy, result);
      if (matched !== null) {
        tail += text;
      } else if (result.isMatch) {
        matched = text;
      } else if (needleIndex !== 0) {
        state.buffer += text;
      } else {
        yield { isMatch: false, content: text };
      }
    }

    if (matched === null) {
      state.currentNeedleIndex = 0;
      state.strategyStates = this.subStrategies.map((subStrategy) =>
        subStrategy.createState()
      );
      yield* super.flush(state);
      return;
    }

    state.buffer += matched;
    state.strategyStates[needleIndex] = subStrategy.createState();
    state.currentNeedleIndex = (needleIndex + 1) % this.subStrategies.length;
    if (state.currentNeedleIndex === 0) {
      const match = state.buffer;
      const endIndex = state.streamOffset - tail.length;
      state.buffer = "";
      yield {
        isMatch: true,
        content: match,
        streamIndices: [endIndex - match.length, endIndex]
      };
    }
    state.streamOffset -= tail.length;
    yield* this.processChunk(tail, state);
    yield* this.flush(state);
  }
}
