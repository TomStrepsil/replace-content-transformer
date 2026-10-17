import type { MatchResult, SearchStrategy } from "./types.js";

const NOTHING_HELD: readonly MatchResult<never>[] = [];

export default function settleOrFlush<TState, TMatch>(
  strategy: Pick<SearchStrategy<TState, TMatch>, "flush" | "settle">,
  state: TState
): Iterable<MatchResult<TMatch>> {
  if (strategy.settle) return strategy.settle(state);
  const held = strategy.flush(state);
  return held ? [{ isMatch: false, content: held }] : NOTHING_HELD;
}
