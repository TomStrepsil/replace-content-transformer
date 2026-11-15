import type { StreamIndices } from "../search-strategies/types.ts";

/**
 * The output sink supplied by an adapter to an engine. The engine calls
 * `enqueue` for every string it produces and `error` (at most once) when
 * a fatal failure occurs; no further `enqueue` calls follow an `error`.
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
