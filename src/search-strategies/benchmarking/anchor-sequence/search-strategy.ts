import type { MatchResult, SearchStrategy, StringBufferState } from "../../types.ts";
import StringBufferStrategyBase from "../../string-buffer-strategy-base.ts";
import settleOrFlush from "../../settle-or-flush.ts";

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
    chunk: string,
    state: AnchorSequenceSearchState<TState>
  ): Generator<MatchResult, void, undefined> {
    const inputLength = chunk.length;
    let haystack = chunk;
    if (state.currentNeedleIndex === 0 && state.buffer) {
      haystack = state.buffer + chunk;
      state.buffer = "";
    }
    let isMidMatch = state.currentNeedleIndex !== 0;
    try {
      do {
        const subStrategy = this.subStrategies[state.currentNeedleIndex];
        const subStrategyState = state.strategyStates[state.currentNeedleIndex];
        const handedOff = haystack;
        haystack = "";
        let matched: string | null = null;
        for (const matchResult of subStrategy.processChunk(
          handedOff,
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
        if (!matched) return;
        state.buffer += matched;
        haystack = subStrategy.flush(subStrategyState);

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
      } while (haystack);
    } finally {
      state.buffer += haystack;
      state.streamOffset += inputLength;
    }
  }

  flush(state: AnchorSequenceSearchState<TState>): string {
    const needleIndex = state.currentNeedleIndex;
    state.currentNeedleIndex = 0;
    return (
      super.flush(state) +
      this.subStrategies[needleIndex].flush(state.strategyStates[needleIndex])
    );
  }

  *settle(
    state: AnchorSequenceSearchState<TState>
  ): Generator<MatchResult, void, undefined> {
    const needleIndex = state.currentNeedleIndex;
    const subStrategy = this.subStrategies[needleIndex];
    let matched: string | null = null;
    let tail = "";
    for (const result of settleOrFlush(
      subStrategy,
      state.strategyStates[needleIndex]
    )) {
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
      const ownHeld = super.flush(state);
      if (ownHeld) yield { isMatch: false, content: ownHeld };
      return;
    }

    state.buffer += matched;
    state.currentNeedleIndex = (needleIndex + 1) % this.subStrategies.length;
    if (state.currentNeedleIndex === 0) {
      const match = state.buffer;
      const endIndex = state.streamOffset - tail.length;
      state.buffer = tail;
      yield {
        isMatch: true,
        content: match,
        streamIndices: [endIndex - match.length, endIndex]
      };
      yield* this.processChunk("", state);
    } else {
      state.streamOffset -= tail.length;
      yield* this.processChunk(tail, state);
    }
    yield* this.settle(state);
  }
}
