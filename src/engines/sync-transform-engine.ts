import type { ReplacementContext, SyncTransformEngine } from "./types.ts";
import { TransformEngineBase } from "./transform-engine-base.ts";
import type { SearchStrategy } from "../search-strategies/types.ts";

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
  searchStrategy: SearchStrategy<TState, TMatch>;
  /**
   * Replacement value or function. Pass a plain `string` for a static
   * replacement; pass a function for per-match control.
   */
  replacement: string | SyncReplacementFn<TMatch>;
  /**
   * When aborted, the engine stops calling the replacement function and
   * passes remaining input through verbatim, flushing any buffered partial
   * match first. Available symmetrically on both Node and web adapters.
   */
  stopReplacingSignal?: AbortSignal;
}

/**
 * Synchronous transform engine.
 *
 * Absorbs the former `StaticReplacementProcessor`, `FunctionReplacementProcessor`,
 * and `IterableFunctionReplacementProcessor`. The adapter calls {@link start}
 * once, then {@link write} per chunk, then {@link end}.
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
    const sink = this.sink!;

    if (this.stopReplacingSignal?.aborted) {
      this.flushAfterAbortIfNeeded();
      sink.enqueue(chunk);
      return;
    }

    for (const result of this.searchStrategy.processChunk(chunk, this.state)) {
      if (!result.isMatch) {
        sink.enqueue(result.content);
        continue;
      }

      if (this.stopReplacingSignal?.aborted) {
        sink.enqueue(result.content as unknown as string);
        continue;
      }

      const ctx: ReplacementContext = {
        matchIndex: this.matchIndex++,
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
  }
}
