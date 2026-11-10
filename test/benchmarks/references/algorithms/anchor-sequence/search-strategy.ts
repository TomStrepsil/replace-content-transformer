import type { MatchSink, SearchStrategy, StringBufferState } from "../../../../../src/search-strategies/types.ts";
import StringBufferStrategyBase from "../../../../../src/search-strategies/string-buffer-strategy-base.ts";
import settleOrFlush from "../../../../../src/search-strategies/settle-or-flush.ts";

export interface AnchorSequenceSearchState<TState> extends StringBufferState {
  currentNeedleIndex: number;
  strategyStates: TState[];
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

  processChunk(
    haystack: string,
    state: AnchorSequenceSearchState<TState>,
    sink: MatchSink
  ): undefined {
    let isMidMatch = state.currentNeedleIndex !== 0;
    if (!isMidMatch) {
      haystack = state.buffer + haystack;
      state.streamOffset -= state.buffer.length;
      state.buffer = "";
    }
    const inputLength = haystack.length;
    try {
      while (haystack) {
        const subStrategy = this.subStrategies[state.currentNeedleIndex];
        const subStrategyState = state.strategyStates[state.currentNeedleIndex];
        let matched = null as string | null;
        subStrategy.processChunk(haystack, subStrategyState, {
          reportText: (content) => {
            if (isMidMatch) state.buffer += content;
            else sink.reportText(content);
          },
          reportMatch: (content) => {
            matched = subStrategy.matchToString(content);
            return false;
          }
        });
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
          if (!sink.reportMatch(match, [startIndex, endIndex])) return;
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
    const needleIndex = state.currentNeedleIndex;
    state.currentNeedleIndex = 0;
    return (
      super.flush(state) +
      this.subStrategies[needleIndex].flush(state.strategyStates[needleIndex])
    );
  }

  settle(state: AnchorSequenceSearchState<TState>, sink: MatchSink): undefined {
    if (state.currentNeedleIndex === 0 && state.buffer) return this.#scanThenSettle("", state, sink);
    const needleIndex = state.currentNeedleIndex;
    const subStrategy = this.subStrategies[needleIndex];
    let matched = null as string | null;
    let tail = "";
    const take = (text: string, isMatch: boolean) => {
      if (matched !== null) {
        tail += text;
      } else if (isMatch) {
        matched = text;
      } else if (needleIndex !== 0) {
        state.buffer += text;
      } else {
        sink.reportText(text);
      }
    };
    settleOrFlush(subStrategy, state.strategyStates[needleIndex], {
      reportText: (content) => take(content, false),
      reportMatch: (content) => {
        take(subStrategy.matchToString(content), true);
        return true;
      }
    });

    if (matched === null) {
      state.currentNeedleIndex = 0;
      state.strategyStates = this.subStrategies.map((subStrategy) =>
        subStrategy.createState()
      );
      const held = super.flush(state);
      if (held) sink.reportText(held);
      return;
    }

    state.buffer += matched;
    state.strategyStates[needleIndex] = subStrategy.createState();
    state.currentNeedleIndex = (needleIndex + 1) % this.subStrategies.length;
    if (state.currentNeedleIndex === 0) {
      const match = state.buffer;
      const endIndex = state.streamOffset - tail.length;
      state.buffer = tail;
      if (sink.reportMatch(match, [endIndex - match.length, endIndex])) this.settle(state, sink);
      return;
    }
    state.streamOffset -= tail.length;
    this.#scanThenSettle(tail, state, sink);
  }

  #scanThenSettle(
    haystack: string,
    state: AnchorSequenceSearchState<TState>,
    sink: MatchSink
  ): undefined {
    let stopped = false;
    this.processChunk(haystack, state, {
      reportText: (content) => sink.reportText(content),
      reportMatch: (content, streamIndices) => !(stopped = !sink.reportMatch(content, streamIndices))
    });
    if (!stopped) this.settle(state, sink);
  }
}
