import type {
  MatchResult,
  SearchStrategy
} from "../search-strategies/types.ts";
import type { EngineSink } from "./types.ts";
import settleOrFlush from "../search-strategies/settle-or-flush.ts";

export const isDefinedSignal = (signal?: AbortSignal): signal is AbortSignal =>
  signal !== undefined;

/**
 * Abstract base for all transform engines.
 *
 * Holds the shared state (`searchStrategy`, `state`, `sink`, `matchIndex`) and
 * provides `start`, the `write`/`end` lifecycle and the abort-flush helpers.
 *
 * Whether `stopReplacingSignal` has aborted is cached from an `abort`
 * listener, so it is read once per match. The listener is on a dependent
 * `AbortSignal.any()` of the given signals, so another listener calling
 * `stopImmediatePropagation()` cannot hide the abort. It is detached once
 * `end()` has finished, on `cancel()` and when `write()` throws, so a
 * long-lived signal does not keep the engine alive. Engines implement
 * `_write` and `_end`, and the base detaches around them.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type
 * @typeParam TResult - `void` for a sync engine, `Promise<void>` for an async one
 */
export abstract class TransformEngineBase<
  TState,
  TMatch,
  TResult extends void | Promise<void>
> {
  protected readonly _searchStrategy: SearchStrategy<TState, TMatch>;
  protected _state: TState;
  protected _sink!: EngineSink;
  protected _matchIndex = 0;
  protected _replacingStopped: boolean;
  readonly #stopReplacingSignal: AbortSignal | undefined;
  readonly #onStopReplacing = (): void => {
    this._replacingStopped = true;
  };
  readonly #stopWatchingSignal = (): void => {
    this.#stopReplacingSignal?.removeEventListener(
      "abort",
      this.#onStopReplacing
    );
  };
  readonly #stopWatchingAndRethrow = (err: unknown): never => {
    this.#stopWatchingSignal();
    throw err;
  };

  #didFlushAfterAbort = false;

  constructor(
    searchStrategy: SearchStrategy<TState, TMatch>,
    ...stopReplacingSignals: (AbortSignal | undefined)[]
  ) {
    this._searchStrategy = searchStrategy;
    this._state = searchStrategy.createState();
    const signals = stopReplacingSignals.filter(isDefinedSignal);
    this._replacingStopped = signals.some((signal) => signal.aborted);
    if (this._replacingStopped || signals.length === 0) return;
    this.#stopReplacingSignal = AbortSignal.any(signals);
    this.#stopReplacingSignal.addEventListener("abort", this.#onStopReplacing, {
      once: true
    });
  }

  start(sink: EngineSink): void {
    this._sink = sink;
  }

  write(chunk: string): TResult {
    try {
      const written = this._write(chunk);
      return (
        written instanceof Promise
          ? written.catch(this.#stopWatchingAndRethrow)
          : written
      ) as TResult;
    } catch (err) {
      return this.#stopWatchingAndRethrow(err);
    }
  }

  end(): TResult {
    let ended: TResult;
    try {
      ended = this._end();
    } catch (err) {
      return this.#stopWatchingAndRethrow(err);
    }
    if (ended instanceof Promise) {
      return ended.finally(this.#stopWatchingSignal) as TResult;
    }
    this.#stopWatchingSignal();
    return ended;
  }

  /**
   * Stop watching `stopReplacingSignal`. Adapters call this when the stream is
   * cancelled or destroyed, so an abandoned stream does not stay registered on a
   * long-lived signal.
   */
  cancel(): void {
    this.#stopWatchingSignal();
  }

  protected abstract _write(chunk: string): TResult;

  protected abstract _end(): TResult;

  protected _settle(): Iterable<MatchResult<TMatch>> {
    return settleOrFlush(this._searchStrategy, this._state);
  }

  protected _renderVerbatim(result: MatchResult<TMatch>): string {
    return result.isMatch
      ? this._searchStrategy.matchToString(result.content)
      : result.content;
  }

  protected _takeHeldAfterAbort(): string {
    if (this.#didFlushAfterAbort) return "";
    this.#didFlushAfterAbort = true;
    return this._searchStrategy.flush(this._state);
  }

  protected _flushAfterAbortIfNeeded(): void {
    const held = this._takeHeldAfterAbort();
    if (held) this._sink.enqueue(held);
  }
}
