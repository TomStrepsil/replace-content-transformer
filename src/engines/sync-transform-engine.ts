import type { ReplacementContext, SyncTransformEngine } from "./types.ts";
import { TransformEngineBase } from "./transform-engine-base.ts";
import type {
  MatchSink,
  SearchStrategy
} from "../search-strategies/types.ts";

/**
 * A replacement function for the sync engine.
 * Return a `string` or an `Iterable<string>` (e.g. an array or a generator).
 * The pieces of an iterable are concatenated into the output of the
 * {@link SyncReplacementTransformEngine.write | write()} that found the
 * match, rather than reaching the sink as separate chunks, unless the
 * engine has a `stopReplacingSignal` and a sink that can react within the
 * call: then each piece is sent before the next is requested, so a
 * generator sees an abort the sink makes on receiving it.
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
   *
   * When given, the output produced so far is sent to the sink before each
   * replacement is called, and after each piece of an iterable replacement,
   * so a sink that aborts on receiving output, such as a Node `data`
   * listener, stops the next replacement, and an iterable that checks the
   * signal between pieces sees the abort. A sink with
   * `EngineSink.isDeliveryDeferred` can't abort that soon, so it still
   * receives one chunk per call.
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
 * Calls `sink.enqueue` at most once per {@link write} and once per
 * {@link end}, with all the output that call produced, and not at all when
 * it produced none. With a `stopReplacingSignal`, unless the sink has
 * `EngineSink.isDeliveryDeferred`, it also enqueues the output so far
 * before each replacement is called and after each piece of an iterable
 * replacement. If the replacement
 * throws, the output produced before it is still enqueued.
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
  #output = "";
  #enqueueBeforeReplacing: boolean | undefined;
  readonly #matchSink: MatchSink<TMatch> = {
    reportText: (content) => {
      this.#output += content;
    },
    reportMatch: (content, streamIndices) => {
      if ((this.#enqueueBeforeReplacing ??= this.#sinkCanReactWithinCall())) {
        this.#enqueueOutput();
      }
      if (this._stopReplacingSignal?.aborted) {
        this.#stoppedAt = this._searchStrategy.matchToString(content);
        return false;
      }
      const replacement = this.#replacement(content, {
        matchIndex: this._matchIndex++,
        streamIndices
      });
      if (typeof replacement === "string") {
        this.#output += replacement;
      } else if (this.#enqueueBeforeReplacing) {
        for (const item of replacement) {
          this.#output += item;
          this.#enqueueOutput();
        }
      } else {
        for (const item of replacement) {
          this.#output += item;
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
    try {
      if (this._stopReplacingSignal?.aborted) {
        this.#appendHeld();
        this.#output += chunk;
        return;
      }
      this.#enqueueBeforeReplacing = undefined;
      this._searchStrategy.processChunk(chunk, this._state, this.#matchSink);
      this.#appendStopped();
    } finally {
      this.#enqueueOutput();
    }
  }

  override end(): void {
    try {
      if (this._stopReplacingSignal?.aborted) {
        this.#appendHeld();
        return;
      }
      this.#enqueueBeforeReplacing = undefined;
      this._settle(this.#matchSink);
      this.#appendStopped();
    } finally {
      this.#enqueueOutput();
    }
  }

  #appendHeld(): void {
    this.#output += this._searchStrategy.flush(this._state);
  }

  #appendStopped(): void {
    if (this.#stoppedAt === undefined) return;
    this.#output += this.#stoppedAt;
    this.#stoppedAt = undefined;
    this.#appendHeld();
  }

  #sinkCanReactWithinCall(): boolean {
    return (
      this._stopReplacingSignal !== undefined && this._sink.isDeliveryDeferred?.() !== true
    );
  }

  #enqueueOutput(): void {
    const output = this.#output;
    if (!output) return;
    this.#output = "";
    this._sink.enqueue(output);
  }
}
