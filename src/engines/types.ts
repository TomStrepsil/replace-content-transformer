import type { StreamIndices } from "../search-strategies/types.ts";

/**
 * UTF-8 bytes, as a replacement may return them, e.g. the chunks of a
 * `fetch` response body, or a Node `Buffer`.
 */
export type Utf8Bytes = Uint8Array;

/**
 * The output sink supplied by an adapter to an engine. The engine calls
 * `enqueue` for every chunk it produces and `error` (at most once) when
 * a fatal failure occurs; no further `enqueue` calls follow an `error`.
 *
 * `enqueue` receives only strings, and bytes a replacement returns are
 * decoded by the engine before reaching it, unless the sink is a
 * {@link ByteEngineSink}.
 */
export interface EngineSink {
  enqueue(chunk: string): void;
  error(err: unknown): void;
  /**
   * `true` when, for the life of the stream, nothing downstream can observe
   * a chunk enqueued during the engine's `write()` or `end()` until that
   * call has returned (for a call that returns a `Promise`, until it first
   * awaits), as with a WHATWG `TransformStreamDefaultController`,
   * whose readers receive chunks through promises.
   * `SerialTransformEngine` then enqueues its synchronous output once per
   * call even with a `stopReplacingSignal`, rather than as it is produced,
   * since nothing downstream could abort the signal any sooner.
   *
   * Engines read it once, in `start()`. Leave it unset when `enqueue` can
   * ever run code synchronously, as a Node `Readable`'s `push()` does once
   * a consumer makes it flow, which can happen part-way through a call.
   */
  readonly deliveryDeferred?: boolean;
  /** `true` only for a {@link ByteEngineSink}. */
  readonly acceptsBytes?: boolean;
}

/**
 * An {@link EngineSink} that also receives UTF-8 bytes. Engines pass bytes a
 * replacement produces asynchronously to `enqueue` rather than decoding
 * them, in order with the strings around them. Each chunk of bytes is valid
 * UTF-8 that ends at a character boundary: a character split across a
 * replacement's pieces is held back until it is whole, and one a
 * replacement leaves incomplete is enqueued as U+FFFD. From a malformed
 * sequence on, the replacement's bytes, up to its end or a string it
 * yields, are enqueued decoded, as strings with U+FFFD in place of what is
 * malformed. A byte order mark at the start of a replacement's bytes, or of
 * bytes that follow a string it yields, is dropped.
 *
 * A chunk of bytes may be a view of the replacement's own buffer, which it
 * may overwrite once `enqueue` returns, so a sink that keeps one must copy
 * it.
 *
 * Engines read `acceptsBytes` once, in `start()`.
 */
export interface ByteEngineSink extends EngineSink {
  enqueue(chunk: string | Utf8Bytes): void;
  readonly acceptsBytes: true;
}

/**
 * Context passed to replacement callbacks.
 *
 * @property matchIndex - Zero-based ordinal for the current match in the stream.
 * @property streamIndices - Absolute stream offsets as [startIndex, endIndex], where endIndex is exclusive.
 */
export type ReplacementContext = {
  matchIndex: number;
  streamIndices: StreamIndices;
};

/**
 * A transform engine. Adapters call {@link start} once, then feed chunks via
 * {@link write}, and signal end-of-stream via {@link end}, one call at a time,
 * which keeps output in order; an engine should not be driven otherwise.
 *
 * {@link write} and {@link end} return `undefined` when the call completed
 * synchronously, or a `Promise` that settles when it completes. The adapter
 * waits for that before the next call, which gives backpressure.
 */
export interface TransformEngine {
  /** Attach the output sink. Must be called exactly once before {@link write}. */
  start(sink: EngineSink): void;
  /** Process one chunk, pushing output to the sink. */
  write(chunk: string): void | Promise<void>;
  /** Flush any buffered tail from the search strategy to the sink. */
  end(): void | Promise<void>;
  /** Optional: called by the adapter when the stream is cancelled or destroyed before it ends, to stop in-flight work. */
  cancel?(): void;
}
