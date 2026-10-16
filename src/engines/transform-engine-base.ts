import type {
  MatchResult,
  SearchStrategy
} from "../search-strategies/types.ts";
import type { EngineSink } from "./types.ts";
import settleOrFlush from "../search-strategies/settle-or-flush.ts";

/**
 * Abstract base for all transform engines.
 *
 * Holds the shared state (`searchStrategy`, `state`, `sink`, `matchIndex`) and
 * provides `start` plus the helpers for settling at the end of the stream and
 * for emitting what a strategy holds once `stopReplacingSignal` has aborted.
 *
 * `end()` is abstract: each engine routes settled results through its own
 * replacement path.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export abstract class TransformEngineBase<TState, TMatch = string> {
  protected readonly _searchStrategy: SearchStrategy<TState, TMatch>;
  protected readonly _stopReplacingSignal: AbortSignal | undefined;
  protected _state: TState;
  protected _sink!: EngineSink;
  protected _matchIndex = 0;

  constructor(
    searchStrategy: SearchStrategy<TState, TMatch>,
    stopReplacingSignal?: AbortSignal
  ) {
    this._searchStrategy = searchStrategy;
    this._stopReplacingSignal = stopReplacingSignal;
    this._state = searchStrategy.createState();
  }

  start(sink: EngineSink): void {
    this._sink = sink;
  }

  abstract end(): void | Promise<void>;

  protected _settle(): Iterable<MatchResult<TMatch>> {
    return settleOrFlush(this._searchStrategy, this._state);
  }

  protected _renderVerbatim(result: MatchResult<TMatch>): string {
    return result.isMatch
      ? this._searchStrategy.matchToString(result.content)
      : result.content;
  }

  protected _takeHeld(before = ""): string {
    return before + this._searchStrategy.flush(this._state);
  }

  protected _enqueueHeld(before = ""): void {
    const held = this._takeHeld(before);
    if (held) this._sink.enqueue(held);
  }
}
