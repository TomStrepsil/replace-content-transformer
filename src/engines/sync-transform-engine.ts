import type { ReplacementContext, SyncTransformEngine } from "./types.ts";
import { TransformEngineBase } from "./transform-engine-base.ts";
import type {
  MatchSink,
  SearchStrategy
} from "../search-strategies/types.ts";

/**
 * A replacement function for the sync engine.
 * Return a `string` or an `Iterable<string>` (e.g. an array or a generator)
 * to emit one or more replacement chunks per match.
 */
export type SyncReplacementFn<TMatch> = (
  match: TMatch,
  context: ReplacementContext
) => string | Iterable<string>;

export interface SyncReplacementTransformEngineOptions<TState, TMatch> {
  /** Search strategy used to locate matches in the input stream. */
  searchStrategy: SearchStrategy<TState, TMatch>;
  /**
   * Replacement value or function. Pass a plain `string` for a static
   * replacement; pass a function for per-match control.
   */
  replacement: string | SyncReplacementFn<TMatch>;
  /**
   * When aborted, the engine stops calling the replacement function and
   * passes remaining input through verbatim, flushing any buffered partial
   * match first. It stops searching too: straight after the output of a
   * replacement that aborts it, or otherwise at the next match it finds,
   * what is left of the current chunk and what the strategy holds are
   * emitted verbatim as one chunk. Available symmetrically on both Node 
   * and web adapters.
   */
  stopReplacingSignal?: AbortSignal;
}

/**
 * Synchronous transform engine.
 *
 * Replaces each match with a static string, or with the string or iterable of
 * strings returned by a function. The adapter calls {@link start} once, then
 * {@link write} per chunk, then {@link end}.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export class SyncReplacementTransformEngine<TState, TMatch = string>
  extends TransformEngineBase<TState, TMatch>
  implements SyncTransformEngine
{
  readonly #replacement: SyncReplacementFn<TMatch>;
  #stoppedAt: string | undefined;
  readonly #matchSink: MatchSink<TMatch> = {
    reportText: (content) => this._sink.enqueue(content),
    reportMatch: (content, streamIndices) => {
      if (this._stopReplacingSignal?.aborted) {
        this.#stoppedAt = this._searchStrategy.matchToString(content);
        return false;
      }
      const replacement = this.#replacement(content, {
        matchIndex: this._matchIndex++,
        streamIndices
      });
      if (typeof replacement === "string") {
        this._sink.enqueue(replacement);
      } else {
        for (const item of replacement) {
          this._sink.enqueue(item);
        }
      }
      if (!this._stopReplacingSignal?.aborted) return true;
      this.#stoppedAt = "";
      return false;
    }
  };

  constructor({
    searchStrategy,
    replacement,
    stopReplacingSignal
  }: SyncReplacementTransformEngineOptions<TState, TMatch>) {
    super(searchStrategy, stopReplacingSignal);
    this.#replacement =
      typeof replacement === "string"
        ? () => replacement as string
        : replacement;
  }

  write(chunk: string): void {
    if (this._stopReplacingSignal?.aborted) {
      this._enqueueHeld();
      this._sink.enqueue(chunk);
      return;
    }

    this._searchStrategy.processChunk(chunk, this._state, this.#matchSink);
    this.#enqueueStopped();
  }

  override end(): void {
    if (this._stopReplacingSignal?.aborted) {
      this._enqueueHeld();
      return;
    }
    this._settle(this.#matchSink);
    this.#enqueueStopped();
  }

  #enqueueStopped(): void {
    if (this.#stoppedAt === undefined) return;
    this._enqueueHeld(this.#stoppedAt);
    this.#stoppedAt = undefined;
  }
}
