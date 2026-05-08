import type { AsyncTransformEngine, ReplacementContext } from "./types.ts";
import { TransformEngineBase } from "./transform-engine-base.ts";
import type { SearchStrategy } from "../search-strategies/types.ts";

/**
 * A replacement function for the async serial engine.
 *
 * Return a `string`, an `AsyncIterable<string>`, or a `Promise` of either.
 * When an `AsyncIterable` is returned, all its chunks are emitted before
 * the next match is processed (serial semantics).
 */
export type AsyncSerialReplacementFn<TMatch> = (
  match: TMatch,
  context: ReplacementContext
) =>
  | string
  | AsyncIterable<string>
  | Promise<string | AsyncIterable<string>>;

export interface AsyncSerialReplacementTransformEngineOptions<TState, TMatch> {
  searchStrategy: SearchStrategy<TState, TMatch>;
  replacement: AsyncSerialReplacementFn<TMatch>;
  /**
   * When aborted, the engine stops calling the replacement function and
   * passes remaining input through verbatim, flushing any buffered partial
   * match first. Available symmetrically on both Node and web adapters.
   */
  stopReplacingSignal?: AbortSignal;
}

/**
 * Async serial transform engine.
 *
 * Absorbs `AsyncFunctionReplacementProcessor` and
 * `AsyncIterableFunctionReplacementProcessor`. Each replacement is fully
 * consumed before the engine scans for the next match; this guarantees
 * in-order output without a concurrency strategy.
 *
 * For concurrent lookahead scheduling, use {@link LookaheadTransformEngine}.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export class AsyncSerialReplacementTransformEngine<TState, TMatch = string>
  extends TransformEngineBase<TState, TMatch>
  implements AsyncTransformEngine
{
  readonly #replacement: AsyncSerialReplacementFn<TMatch>;
  #cancelled = false;

  constructor({
    searchStrategy,
    replacement,
    stopReplacingSignal
  }: AsyncSerialReplacementTransformEngineOptions<TState, TMatch>) {
    super(searchStrategy, stopReplacingSignal);
    this.#replacement = replacement;
  }

  async write(chunk: string): Promise<void> {
    if (this.#cancelled) return;
    const sink = this._sink!;

    if (this._stopReplacingSignal?.aborted) {
      this._flushAfterAbortIfNeeded();
      sink.enqueue(chunk);
      return;
    }

    for (const result of this._searchStrategy.processChunk(chunk, this._state)) {
      if (this.#cancelled) return;

      if (!result.isMatch) {
        sink.enqueue(result.content);
        continue;
      }

      if (this._stopReplacingSignal?.aborted) {
        sink.enqueue(result.content as unknown as string);
        continue;
      }

      const ctx: ReplacementContext = {
        matchIndex: this._matchIndex++,
        streamIndices: result.streamIndices
      };
      const raw = await this.#replacement(result.content, ctx);

      if (this.#cancelled) return;

      if (typeof raw === "string") {
        sink.enqueue(raw);
      } else {
        for await (const item of raw) {
          if (this.#cancelled) return;
          sink.enqueue(item);
          if (this._stopReplacingSignal?.aborted) break;
        }
      }
    }
  }

  cancel(): void {
    this.#cancelled = true;
  }
}
