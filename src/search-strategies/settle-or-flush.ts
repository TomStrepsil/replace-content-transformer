import type { MatchSink, SearchStrategy } from "./types.js";

export default function settleOrFlush<TState, TMatch>(
  strategy: Pick<SearchStrategy<TState, TMatch>, "flush" | "settle">,
  state: TState,
  sink: MatchSink<TMatch>
): void {
  if (strategy.settle) return strategy.settle(state, sink);
  const held = strategy.flush(state);
  if (held) sink.reportText(held);
}
