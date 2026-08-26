import type { MatchResult, SearchStrategy } from "../../types.ts";
import StringBufferStrategyBase, {
  type StringBufferState
} from "../../string-buffer-strategy-base.ts";

export interface AnchorSequenceSearchState<TState> extends StringBufferState {
  currentNeedleIndex: number;
  strategyStates: TState[];
}

function drainToString<TState, TMatch>(
  subStrategy: SearchStrategy<TState, TMatch>,
  subStrategyState: TState
): string {
  let buffered = "";
  for (const result of subStrategy.flush(subStrategyState)) {
    buffered += result.isMatch
      ? subStrategy.matchToString(result.content)
      : result.content;
  }
  return buffered;
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
    let carried = "";

    for (;;) {
      const needleIndex = state.currentNeedleIndex;
      const subStrategy = this.subStrategies[needleIndex];
      const subStrategyState = state.strategyStates[needleIndex];

      const settled = carried
        ? [
            ...subStrategy.processChunk(carried, subStrategyState),
            ...subStrategy.flush(subStrategyState)
          ]
        : [...subStrategy.flush(subStrategyState)];
      carried = "";

      let matched: string | null = null;
      let afterMatch = "";
      for (const result of settled) {
        if (result.isMatch && matched === null) {
          matched = extractMatchContent(result.content);
          continue;
        }
        const text = result.isMatch
          ? subStrategy.matchToString(result.content)
          : result.content;
        if (matched !== null) {
          afterMatch += text;
        } else if (needleIndex === 0) {
          if (text) yield { isMatch: false, content: text };
        } else {
          state.buffer += text;
        }
      }

      if (matched === null) break;

      state.buffer += matched;
      state.strategyStates[needleIndex] = subStrategy.createState();
      state.currentNeedleIndex =
        (needleIndex + 1) % this.subStrategies.length;
      carried = afterMatch;

      const sequenceComplete = state.currentNeedleIndex === 0;
      if (sequenceComplete) {
        const match = state.buffer;
        const endIndex = state.streamOffset - carried.length;
        state.buffer = "";
        yield {
          isMatch: true,
          content: match,
          streamIndices: [endIndex - match.length, endIndex]
        };
      }
    }

    const remainder = state.buffer + carried;
    state.buffer = "";
    state.streamOffset = 0;
    if (remainder) yield { isMatch: false, content: remainder };
  }
}
