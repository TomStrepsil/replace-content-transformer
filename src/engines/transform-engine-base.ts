import type {
  MatchResult,
  SearchStrategy
} from "../search-strategies/types.ts";
import type { EngineSink } from "./types.ts";

/**
 * Abstract base for all transform engines.
 *
 * Holds the shared state (`searchStrategy`, `state`, `sink`, `matchIndex`) and
 * provides `start` plus the abort-flush helper used by the sync and
 * async-serial engines.
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

  abstract end(): void | Promise<void>;

  protected _flush(): Iterable<MatchResult<TMatch>> {
    return this._searchStrategy.flush(this._state);
  }

  protected _renderVerbatim(result: MatchResult<TMatch>): string {
    return result.isMatch
      ? this._searchStrategy.matchToString(result.content)
      : result.content;
  }

  protected _flushAfterAbortIfNeeded(): void {
    if (this.#didFlushAfterAbort) return;
    this.#didFlushAfterAbort = true;
    for (const result of this._flush()) {
      const tail = this._renderVerbatim(result);
      if (tail) this._sink.enqueue(tail);
    }
  }
}
