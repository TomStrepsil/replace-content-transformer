import type { SearchStrategy } from "../search-strategies/types.ts";
import type { EngineSink } from "./types.ts";

/**
 * Abstract base for all transform engines.
 *
 * Holds the shared state (`searchStrategy`, `state`, `sink`, `matchIndex`) and
 * provides default implementations of `start`, `end`, and the abort-flush
 * helper used by the sync and async-serial engines.
 *
 * Subclasses that need async `end` semantics (e.g. the lookahead engine)
 * should override `end()`.
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

  #didFlushAfterAbort = false;

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

  end(): void | Promise<void> {
    const tail = this._searchStrategy.flush(this._state);
    if (tail) this._sink.enqueue(tail);
  }

  protected _flushAfterAbortIfNeeded(): void {
    if (this.#didFlushAfterAbort) return;
    this.#didFlushAfterAbort = true;
    const tail = this._searchStrategy.flush(this._state);
    if (tail) this._sink.enqueue(tail);
  }
}
