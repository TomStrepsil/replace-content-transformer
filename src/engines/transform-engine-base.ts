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
  protected readonly searchStrategy: SearchStrategy<TState, TMatch>;
  protected readonly stopReplacingSignal: AbortSignal | undefined;
  protected state: TState;
  protected sink: EngineSink | null = null;
  protected matchIndex = 0;

  #didFlushAfterAbort = false;

  constructor(
    searchStrategy: SearchStrategy<TState, TMatch>,
    stopReplacingSignal?: AbortSignal
  ) {
    this.searchStrategy = searchStrategy;
    this.stopReplacingSignal = stopReplacingSignal;
    this.state = searchStrategy.createState();
  }

  start(sink: EngineSink): void {
    this.sink = sink;
  }

  end(): void | Promise<void> {
    const tail = this.searchStrategy.flush(this.state);
    if (tail) this.sink!.enqueue(tail);
  }

  protected flushAfterAbortIfNeeded(): void {
    if (this.#didFlushAfterAbort) return;
    this.#didFlushAfterAbort = true;
    const tail = this.searchStrategy.flush(this.state);
    if (tail) this.sink!.enqueue(tail);
  }
}
