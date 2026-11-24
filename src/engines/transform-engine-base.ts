import type {
  MatchSink,
  SearchStrategy
} from "../search-strategies/types.ts";
import type { EngineSink, Utf8Bytes } from "./types.ts";
import settleOrFlush from "../search-strategies/settle-or-flush.ts";

/**
 * Abstract base for all transform engines.
 *
 * Holds the shared state (`searchStrategy`, `state`, `sink`, `matchIndex`) and
 * provides `start` plus the helpers for settling at the end of the stream and
 * for resuming a search stopped at a match.
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
  protected _sinkFailed = false;
  #wakeFromReady: (() => void) | undefined;
  #readinessIgnored = false;
  #room = 0;

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

  protected _untilReady(): Promise<void> | undefined {
    if (this.#readinessIgnored) return;
    const ready = this._sink.ready?.();
    if (ready === undefined) return;
    return new Promise((resolve) => {
      this.#wakeFromReady = resolve;
      void ready.then(resolve);
    });
  }

  protected _ignoreReadiness(): void {
    this.#readinessIgnored = true;
    this.#wakeFromReady?.();
  }

  protected _fitsRoom(length: number): boolean {
    if (length < this.#room) return true;
    this.#room = this._sink.room?.() ?? 0;
    return length < this.#room;
  }

  protected _enqueueTo<TChunk extends string | Utf8Bytes>(sink: { enqueue(chunk: TChunk): void }, chunk: TChunk): void {
    this.#room -= chunk.length;
    try {
      sink.enqueue(chunk);
    } catch (error) {
      this._sinkFailed = true;
      throw error;
    }
  }

  protected _failureRecordingSink(sink: EngineSink): Pick<EngineSink, "enqueue" | "acceptsBytes"> {
    return { enqueue: (chunk) => this._enqueueTo(sink, chunk), acceptsBytes: sink.acceptsBytes };
  }

  abstract end(): void | Promise<void>;

  protected _settle(sink: MatchSink<TMatch>): void {
    settleOrFlush(this._searchStrategy, this._state, sink);
  }

  protected _resume(settling: boolean, sink: MatchSink<TMatch>): void {
    if (settling) this._settle(sink);
    else this._searchStrategy.processChunk("", this._state, sink);
  }
}
