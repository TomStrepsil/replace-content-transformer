import type { ReplacementContext, SyncTransformEngine } from "./types.ts";
import { TransformEngineBase } from "./transform-engine-base.ts";
import type {
  MatchResult,
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
   * match first. It stops searching too, at the next match it finds: that
   * match, the rest of the current chunk and what the strategy holds are
   * emitted verbatim as one chunk. Available
   * symmetrically on both Node and web adapters.
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

    this.#emit(this._searchStrategy.processChunk(chunk, this._state));
  }

  override end(): void {
    if (this._stopReplacingSignal?.aborted) {
      this._enqueueHeld();
      return;
    }
    this.#emit(this._settle());
  }

  #emit(results: Iterable<MatchResult<TMatch>>): void {
    const sink = this._sink;
    let stoppedAt: string | undefined;

    for (const result of results) {
      if (!result.isMatch) {
        sink.enqueue(result.content);
        continue;
      }

      if (this._stopReplacingSignal?.aborted) {
        stoppedAt = this._renderVerbatim(result);
        break;
      }

      const ctx: ReplacementContext = {
        matchIndex: this._matchIndex++,
        streamIndices: result.streamIndices
      };
      const replacement = this.#replacement(result.content, ctx);

      if (typeof replacement === "string") {
        sink.enqueue(replacement);
      } else {
        for (const item of replacement) {
          sink.enqueue(item);
        }
      }
    }
    if (stoppedAt !== undefined) this._enqueueHeld(stoppedAt);
  }
}
