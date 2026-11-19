import type {
  ByteEngineSink,
  EngineSink,
  ReplacementContext,
  TransformEngine,
  Utf8Bytes
} from "./types.ts";
import { TransformEngineBase } from "./transform-engine-base.ts";
import { closeAbandoned, ignore } from "./abandon.ts";
import { failedWithReasonOf } from "./abort-reason.ts";
import type { MatchSink, SearchStrategy } from "../search-strategies/types.ts";
import {
  acceptsBytes,
  isUtf8Bytes,
  replacementPieceForwarder,
  type ReplacementPieceForwarder
} from "./replacement-pieces.ts";

type SyncReplacement = string | Utf8Bytes | Iterable<string | Utf8Bytes>;
type ReplacementValue = SyncReplacement | AsyncIterable<string | Utf8Bytes>;

/**
 * What a {@link SerialReplacementFn} may return: a `string`, UTF-8 bytes
 * (a `Uint8Array`), an `Iterable` of strings and UTF-8 bytes (e.g. an array
 * or a generator), an `AsyncIterable` of strings and UTF-8 bytes (e.g. an async generator, or a
 * `ReadableStream` such as a `fetch` response body), or a `PromiseLike` of
 * any of these.
 */
export type SerialReplacement = ReplacementValue | PromiseLike<ReplacementValue>;

/**
 * A replacement function for {@link SerialTransformEngine}.
 *
 * A `string`, bytes or an `Iterable` is consumed within the call that found
 * the match, bytes decoded into its output. Anything else is
 * awaited, and an `AsyncIterable` read to its end, before the search carries
 * on, and makes that call return a `Promise`. A value that is both iterable
 * and async iterable is read as an iterable.
 *
 * Bytes are read as UTF-8, as one sequence for each replacement, so a
 * character split across its pieces is kept whole, and one it leaves
 * incomplete becomes U+FFFD, as do malformed bytes. A byte order mark at the
 * start of a replacement's bytes, or of bytes that follow a string it
 * yields, is dropped. Those it produces asynchronously, whether a `Promise`
 * resolves to them or to an iterable of them, or an `AsyncIterable` yields
 * them, go to a sink with `EngineSink.acceptsBytes` without being decoded
 * (see `ByteEngineSink`), and are otherwise decoded.
 *
 * @typeParam TMatch - The search strategy's match type
 * @typeParam TReturn - What the function returns
 */
export type SerialReplacementFn<
  TMatch,
  TReturn extends SerialReplacement = SerialReplacement
> = (match: TMatch, context: ReplacementContext) => TReturn;

/**
 * What {@link SerialTransformEngine.write} and {@link SerialTransformEngine.end}
 * return for a given `replacement`: `void` when it is a `string` or a function
 * that can only return a `string`, bytes or an `Iterable`, otherwise
 * `void | Promise<void>`.
 */
export type SerialEngineCallResult<TReplacement> = CallResultFor<
  TReplacement extends SerialReplacementFn<never, infer TReturn> ? TReturn : string
>;

type CallResultFor<TReturn> = 0 extends 1 & TReturn
  ? void | Promise<void>
  : [TReturn] extends [SyncReplacement]
    ? void
    : void | Promise<void>;

export interface SerialTransformEngineOptions<
  TState,
  TMatch = string,
  TReplacement extends
    | string
    | SerialReplacementFn<TMatch> = string | SerialReplacementFn<TMatch>
> {
  /** Search strategy used to locate matches in the input stream. */
  searchStrategy: SearchStrategy<TState, TMatch>;
  /**
   * Replacement value or function. Pass a plain `string` for a static
   * replacement; pass a function for per-match control.
   */
  replacement: TReplacement;
  /**
   * When aborted, the engine stops calling the replacement function and
   * passes remaining input through verbatim, flushing any buffered partial
   * match first. It stops searching too: straight after the output of a
   * replacement that aborts it, or otherwise at the next match it finds,
   * what is left of the current chunk and what the strategy holds are
   * emitted verbatim as one chunk. A replacement already called runs to
   * completion: an iterable or async iterable one is read to its end, so
   * to end one early, have it check the signal itself. One that fails with
   * the signal's `reason`, or an error with the `reason` in its `cause`
   * chain, as a `fetch` passed the signal does, ends there instead of
   * erroring the stream: its match is emitted verbatim if it had produced
   * nothing, and otherwise only what it produced. Available symmetrically
   * on both Node and web adapters.
   *
   * When given, synchronous output is sent to the sink as it is produced:
   * each run of text, each replacement, and each piece of an iterable one.
   * So a sink that aborts on receiving output, such as a Node `data`
   * listener, stops the search straight after that output, and a callback
   * such as `onGuardExceeded`, or an iterable that checks the signal
   * between pieces, sees the abort. A Node stream passes output on only
   * while it is flowing with nothing buffered, so a consumer that is behind
   * or not yet reading may see it only after later replacements have been
   * called. A sink with `EngineSink.deliveryDeferred` can't abort that soon,
   * so it still receives synchronous output once per call.
   */
  stopReplacingSignal?: AbortSignal;
}

const scanCancelled = new Error("Scan cancelled");

function isPromiseLike<T>(value: PromiseLike<T> | object): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T>).then === "function";
}

function closeIfAsyncIterable(replacement: ReplacementValue): Promise<void> | undefined {
  if (typeof replacement === "string" || Symbol.iterator in replacement) return;
  return closeAbandoned(replacement);
}

/**
 * Serial transform engine, for synchronous and asynchronous replacements.
 *
 * Replaces each match with a static string, or with what a function returns
 * (see {@link SerialReplacementFn}), consuming each replacement fully before
 * searching for the next match, so output is in order without a concurrency
 * strategy. For concurrent replacements, use {@link LookaheadTransformEngine}.
 *
 * {@link write} and {@link end} return `undefined` when every replacement in
 * the call was synchronous, and otherwise a `Promise` that settles once the
 * call's output has all been enqueued. An error thrown by the replacement or
 * the search strategy is thrown by the call, or rejects its `Promise` once
 * the call has gone asynchronous.
 *
 * Calls `sink.enqueue` once with the output a call produces synchronously
 * (none when it produced none), except that output longer than the longest
 * string the runtime can build is split where it would overflow. With a
 * `stopReplacingSignal`, unless the sink has `EngineSink.deliveryDeferred`,
 * it enqueues that output as it is produced instead (see that option).
 * Before awaiting an asynchronous replacement, it enqueues the output so far;
 * it then enqueues the awaited replacement, or each piece of an async
 * iterable as it arrives, and the output of the search resumed after it as
 * before. If the replacement throws, the output produced before it is still
 * enqueued.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 * @typeParam TReplacement - The `replacement` option's type, inferred from it
 */
export class SerialTransformEngine<
    TState,
    TMatch = string,
    TReplacement extends
      | string
      | SerialReplacementFn<TMatch> = string | SerialReplacementFn<TMatch>
  >
  extends TransformEngineBase<TState, TMatch>
  implements TransformEngine
{
  readonly #replacement: SerialReplacementFn<TMatch>;
  #stoppedAt: string | undefined;
  #output = "";
  #enqueueAsProduced = false;
  #pieces!: ReplacementPieceForwarder;
  readonly #producedPieces = replacementPieceForwarder({
    enqueue: (text: string) => this.#appendProduced(text)
  });
  #awaitedIterablePieces!: ReplacementPieceForwarder;
  #pending: Promise<ReplacementValue> | AsyncIterable<string | Utf8Bytes> | undefined;
  #pendingMatch: TMatch | undefined;
  #cancelled = false;
  readonly #matchSink: MatchSink<TMatch> = {
    reportText: (content) => {
      if (this.#cancelled) throw scanCancelled;
      this.#appendProduced(content);
    },
    reportMatch: (content, streamIndices) => {
      if (this.#cancelled) throw scanCancelled;
      if (this._stopReplacingSignal?.aborted) {
        this.#stoppedAt = this._searchStrategy.matchToString(content);
        return false;
      }
      try {
        const replacement = this.#replacement(content, {
          matchIndex: this._matchIndex++,
          streamIndices
        });
        if (typeof replacement === "string") {
          this.#appendProduced(replacement);
        } else if (Symbol.iterator in replacement) {
          this.#forwardIterable(replacement, this.#producedPieces);
        } else {
          this.#pending = isPromiseLike(replacement) ? Promise.resolve(replacement) : replacement;
          this.#pendingMatch = content;
          return false;
        }
      } catch (error) {
        this.#endStoppedReplacement(error, this.#producedPieces, content);
      }
      if (this.#cancelled) throw scanCancelled;
      if (!this._stopReplacingSignal?.aborted) return true;
      this.#stoppedAt = "";
      return false;
    }
  };

  constructor({
    searchStrategy,
    replacement,
    stopReplacingSignal
  }: SerialTransformEngineOptions<TState, TMatch, TReplacement>) {
    super(searchStrategy, stopReplacingSignal);
    this.#replacement =
      typeof replacement === "string"
        ? () => replacement
        : replacement;
  }

  override start(sink: EngineSink): void {
    super.start(sink);
    this.#enqueueAsProduced =
      this._stopReplacingSignal !== undefined && sink.deliveryDeferred !== true;
    this.#pieces = replacementPieceForwarder(sink);
    this.#awaitedIterablePieces = acceptsBytes(sink)
      ? replacementPieceForwarder({
          enqueue: (chunk: string | Utf8Bytes) => this.#appendOrEnqueueBytes(chunk, sink),
          acceptsBytes: true
        })
      : this.#producedPieces;
  }

  write(chunk: string): SerialEngineCallResult<TReplacement>;
  write(chunk: string): void | Promise<void> {
    return this.#run(chunk, false);
  }

  override end(): SerialEngineCallResult<TReplacement>;
  override end(): void | Promise<void> {
    return this.#run("", true);
  }

  /**
   * Stops the engine: later calls do nothing, and a call under way enqueues
   * nothing further and stops at the next point it regains control: the
   * next text or match the search strategy reports, the return of the
   * replacement that cancelled it, the next piece of a replacement being
   * read, or the next asynchronous step, without awaiting another
   * replacement. A replacement it has called but not read is left to
   * settle, its rejection ignored, and then closed if it is an async
   * iterable. Called by the adapter when the stream is cancelled
   * or destroyed before it ends.
   */
  cancel(): void {
    this.#cancelled = true;
  }

  #run(chunk: string, settling: boolean): void | Promise<void> {
    if (this.#cancelled) return;
    try {
      if (this._stopReplacingSignal?.aborted) {
        this.#appendHeld();
        this.#append(chunk);
        return;
      }
      if (settling) this._settle(this.#matchSink);
      else this._searchStrategy.processChunk(chunk, this._state, this.#matchSink);
      if (this.#pending !== undefined) return this.#replaceAsync(settling);
      this.#appendStopped();
    } catch (error) {
      if (error !== scanCancelled) throw error;
    } finally {
      this.#enqueueOutput();
    }
  }

  async #replaceAsync(settling: boolean): Promise<void> {
    try {
      this.#enqueueOutput();
      while (this.#pending !== undefined && !this.#cancelled) {
        const pending = this.#pending;
        let replacement: ReplacementValue;
        try {
          replacement = pending instanceof Promise ? await pending : pending;
        } catch (error) {
          if (!this.#stoppedBy(error)) throw error;
          replacement = this._searchStrategy.matchToString(this.#pendingMatch!);
        }
        if (this.#cancelled) return;
        this.#pending = undefined;
        if (typeof replacement === "string") {
          if (replacement) this._sink.enqueue(replacement);
        } else if (Symbol.iterator in replacement) {
          try {
            this.#forwardIterable(replacement, this.#awaitedIterablePieces);
          } catch (error) {
            this.#endStoppedReplacement(error, this.#awaitedIterablePieces, this.#pendingMatch!);
          }
          this.#enqueueOutput();
        } else {
          try {
            for await (const piece of replacement) {
              if (this.#cancelled) return;
              this.#pieces.piece(piece);
              if (this.#cancelled) return;
            }
            if (this.#cancelled) return;
            this.#pieces.end();
          } catch (error) {
            this.#endStoppedReplacement(error, this.#pieces, this.#pendingMatch!);
          }
        }
        this.#pendingMatch = undefined;
        if (this.#cancelled) return;
        if (this._stopReplacingSignal?.aborted) {
          this.#appendHeld();
          return;
        }
        this._resume(settling, this.#matchSink);
        if (this.#pending === undefined) this.#appendStopped();
        this.#enqueueOutput();
      }
    } catch (error) {
      if (error !== scanCancelled) throw error;
    } finally {
      this.#abandonPending();
      this.#enqueueOutput();
    }
  }

  #stoppedBy(error: unknown): boolean {
    return failedWithReasonOf(this._stopReplacingSignal, error);
  }

  #endStoppedReplacement(error: unknown, pieces: ReplacementPieceForwarder, match: TMatch): void {
    if (!this.#stoppedBy(error)) throw error;
    if (this.#cancelled) throw scanCancelled;
    pieces.end(this._searchStrategy.matchToString(match));
  }

  #abandonPending(): void {
    const abandoned = this.#pending;
    if (abandoned === undefined) return;
    this.#pending = undefined;
    this.#pendingMatch = undefined;
    void Promise.resolve(abandoned).then(closeIfAsyncIterable).catch(ignore);
  }

  #forwardIterable(replacement: Utf8Bytes | Iterable<string | Utf8Bytes>, pieces: ReplacementPieceForwarder): void {
    if (this.#cancelled) throw scanCancelled;
    for (const piece of isUtf8Bytes(replacement) ? [replacement] : replacement) {
      pieces.piece(piece);
      if (this.#cancelled) throw scanCancelled;
    }
    pieces.end();
  }

  #appendOrEnqueueBytes(chunk: string | Utf8Bytes, sink: ByteEngineSink): void {
    if (typeof chunk === "string") {
      this.#appendProduced(chunk);
      return;
    }
    this.#enqueueOutput();
    if (this.#cancelled) throw scanCancelled;
    sink.enqueue(chunk);
  }

  #appendProduced(content: string): void {
    this.#append(content);
    if (this.#enqueueAsProduced) this.#enqueueProduced();
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
    } catch {
      this.#enqueueOutput();
      this.#output = content;
    }
  }

  #enqueueProduced(): void {
    this.#enqueueOutput();
    if (this.#cancelled) throw scanCancelled;
  }

  #enqueueOutput(): void {
    const output = this.#output;
    if (!output || this.#cancelled) return;
    this.#output = "";
    this._sink.enqueue(output);
  }
}
