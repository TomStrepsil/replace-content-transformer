import type {
  EngineSink,
  ReplacementContext,
  SyncTransformEngine
} from "./types.ts";
import { TransformEngineBase } from "./transform-engine-base.ts";
import type { MatchSink, SearchStrategy } from "../search-strategies/types.ts";

/**
 * A replacement function for the sync engine.
 * Return a `string` or an `Iterable<string>` (e.g. an array or a generator).
 * The pieces of an iterable are concatenated into the output of the
 * {@link SyncReplacementTransformEngine.write | write()} that found the
 * match, rather than reaching the sink as separate chunks, unless the
 * engine has a `stopReplacingSignal` and a sink that can react within the
 * call (see that option).
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
   * When given, output is sent to the sink as it is produced: each run of
   * text, each replacement, and each piece of an iterable one. So a sink
   * that aborts on receiving output, such as a Node `data` listener, stops
   * the search straight after that output, and a callback such as
   * `onGuardExceeded`, or an iterable that checks the signal between
   * pieces, sees the abort. A sink with `EngineSink.deliveryDeferred`
   * can't abort that soon, so it still receives one chunk per call.
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
 * it produced none, except that output longer than the longest string the
 * runtime can build is split where it would overflow. With a
 * `stopReplacingSignal`, unless the sink has `EngineSink.deliveryDeferred`,
 * it enqueues output as it is produced instead (see that option). If the
 * replacement throws, the output produced before it is still enqueued.
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
  #enqueueAsProduced = false;
  readonly #matchSink: MatchSink<TMatch> = {
    reportText: (content) => {
      this.#append(content);
      if (this.#enqueueAsProduced) this.#enqueueOutput();
    },
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
        this.#append(replacement);
        if (this.#enqueueAsProduced) this.#enqueueOutput();
      } else if (this.#enqueueAsProduced) {
        for (const item of replacement) {
          this.#output += item;
          this.#enqueueOutput();
        }
      } else {
        for (const item of replacement) {
          this.#append(item);
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

  override start(sink: EngineSink): void {
    super.start(sink);
    this.#enqueueAsProduced =
      this._stopReplacingSignal !== undefined && sink.deliveryDeferred !== true;
  }

  write(chunk: string): void {
    try {
      if (this._stopReplacingSignal?.aborted) {
        this.#appendHeld();
        this.#append(chunk);
        return;
      }
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
      this._settle(this.#matchSink);
      this.#appendStopped();
    } finally {
      this.#enqueueOutput();
    }
  }

  #appendHeld(): void {
    this.#append(this._searchStrategy.flush(this._state));
  }

  #appendStopped(): void {
    if (this.#stoppedAt === undefined) return;
    this.#append(this.#stoppedAt);
    this.#stoppedAt = undefined;
    this.#appendHeld();
  }

  #append(content: string): void {
    try {
      this.#output += content;
    } catch (error) {
      if (typeof content !== "string") throw error;
      this.#enqueueOutput();
      this.#output = content;
    }
  }

  #enqueueOutput(): void {
    const output = this.#output;
    if (!output) return;
    this.#output = "";
    this._sink.enqueue(output);
  }
}
