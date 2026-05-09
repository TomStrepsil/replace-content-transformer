import type { StreamIndices } from "../search-strategies/types.ts";

/**
 * The output sink supplied by an adapter to an engine. The engine calls
 * `enqueue` for every string it produces and `error` (at most once) when
 * a fatal failure occurs; no further `enqueue` calls follow an `error`.
 */
export interface EngineSink {
  enqueue(chunk: string): void;
  error(err: unknown): void;
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

export interface TransformEngine<T> {
  /** Attach the output sink. Must be called exactly once before {@link write}. */
  start(sink: EngineSink): void;
  write(chunk: string): T;
}

/**
 * A synchronous transform engine. Adapters call {@link start} once, then
 * feed chunks via {@link write}, and signal end-of-stream via {@link end}.
 * All output is pushed synchronously to the sink supplied in {@link start}.
 */
export interface SyncTransformEngine extends TransformEngine<void> {
  /** Process one chunk synchronously, pushing output to the sink. */
  write(chunk: string): void;
  /** Flush any buffered tail from the search strategy to the sink. */
  end(): void;
}

/**
 * An asynchronous transform engine. Adapters call {@link start} once, then
 * feed chunks via {@link write}, and signal end-of-stream via {@link end}.
 * The returned Promises provide backpressure: the adapter should await each
 * call before proceeding.
 */
export interface AsyncTransformEngine extends TransformEngine<Promise<void>> {
  /** Process one chunk, pushing output to the sink. May be awaited for backpressure. */
  write(chunk: string): Promise<void>;
  /** Flush any buffered tail from the search strategy to the sink. */
  end(): void | Promise<void>;
  /** Optional: called by the adapter when the readable side is cancelled, to stop in-flight work. */
  cancel?(): void;
}
