import type { AsyncTransformEngine, ReplacementContext } from "./types.ts";
import { TransformEngineBase } from "./transform-engine-base.ts";
import type {
  MatchSink,
  SearchStrategy,
  StreamIndices
} from "../search-strategies/types.ts";

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
) => string | AsyncIterable<string> | Promise<string | AsyncIterable<string>>;

export interface AsyncSerialReplacementTransformEngineOptions<TState, TMatch> {
  /** Search strategy used to locate matches in the input stream. */
  searchStrategy: SearchStrategy<TState, TMatch>;
  /** Function invoked for every match; its result is streamed in place of the match. */
  replacement: AsyncSerialReplacementFn<TMatch>;
  /**
   * When aborted, the engine stops calling the replacement function and
   * passes remaining input through verbatim, flushing any buffered partial
   * match first. It stops searching too: straight after the output of a
   * replacement that aborts it, or otherwise at the next match it finds,
   * what is left of the current chunk and what the strategy holds are
   * emitted verbatim as one chunk. Available
   * symmetrically on both Node and web adapters.
   */
  stopReplacingSignal?: AbortSignal;
}

/**
 * Async serial transform engine.
 *
 * Each replacement is fully consumed before the engine scans for the next
 * match; this guarantees in-order output without a concurrency strategy.
 *
 * For concurrent lookahead scheduling, use {@link AsyncLookaheadTransformEngine}.
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
  #pending: { match: TMatch; streamIndices: StreamIndices } | undefined;
  readonly #matchSink: MatchSink<TMatch> = {
    reportText: (content) => {
      if (!this.#cancelled) this._sink.enqueue(content);
    },
    reportMatch: (match, streamIndices) => {
      this.#pending = { match, streamIndices };
      return false;
    }
  };

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

    if (this._stopReplacingSignal?.aborted) {
      this._enqueueHeld();
      this._sink.enqueue(chunk);
      return;
    }

    this._searchStrategy.processChunk(chunk, this._state, this.#matchSink);
    await this.#replacePending(false);
  }

  override async end(): Promise<void> {
    if (this.#cancelled) return;
    if (this._stopReplacingSignal?.aborted) {
      this._enqueueHeld();
      return;
    }
    this._settle(this.#matchSink);
    await this.#replacePending(true);
  }

  async #replacePending(settling: boolean): Promise<void> {
    const sink = this._sink;
    while (this.#pending !== undefined && !this.#cancelled) {
      const { match, streamIndices } = this.#pending;
      this.#pending = undefined;

      if (this._stopReplacingSignal?.aborted) {
        this._enqueueHeld(this._searchStrategy.matchToString(match));
        return;
      }

      const raw = await this.#replacement(match, {
        matchIndex: this._matchIndex++,
        streamIndices
      });

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
      if (this.#cancelled) return;
      if (this._stopReplacingSignal?.aborted) {
        this._enqueueHeld();
        return;
      }
      this._resume(settling, this.#matchSink);
    }
  }

  cancel(): void {
    this.#cancelled = true;
  }
}
