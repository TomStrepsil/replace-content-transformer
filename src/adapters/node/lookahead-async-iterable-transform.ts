import { Transform, type TransformCallback, type TransformOptions } from "node:stream";
import type { BufferEncoding } from "node:buffer";
import {
  LookaheadEngine,
  type LookaheadAsyncIterableTransformerOptions
} from "../../lookahead/engine.ts";

/**
 * Options accepted by {@link LookaheadAsyncIterableTransform}: the
 * engine options plus a small subset of `stream.TransformOptions` that
 * are meaningful when the upstream payload is text.
 *
 * `streamHighWaterMark` is forwarded to the underlying `stream.Transform`'s
 * own `highWaterMark`, giving callers native Node-stream backpressure
 * control that composes with the engine's `highWaterMark` on the slot
 * queue. Named distinctly so the two are never confused.
 */
export interface LookaheadAsyncIterableTransformOptions<TState, TMatch>
  extends LookaheadAsyncIterableTransformerOptions<TState, TMatch> {
  /** Node stream high-water mark in bytes/objects. @default Node default (16 KiB) */
  streamHighWaterMark?: number;
}

/**
 * A Node.js `stream.Transform` that scans streaming text for matches
 * and replaces each one with the chunks of an `AsyncIterable<string>`
 * produced by an async replacement function.
 *
 * Node-streams counterpart to `LookaheadAsyncIterableTransformer`
 * (WHATWG). Both adapters share the same {@link LookaheadEngine} core,
 * so scan/schedule/drain semantics — including nested `nested()`
 * re-scanning, in-order output, bounded concurrency via the injected
 * `ConcurrencyStrategy`, and `highWaterMark` backpressure — behave
 * identically across runtimes.
 *
 * Node-specific behaviour layered on top:
 *
 * - Incoming chunks are decoded to strings via `chunk.toString()` (UTF-8),
 *   consistent with the other Node adapters in this package.
 * - `streamHighWaterMark` is forwarded to the underlying `Transform`,
 *   composing Node's own backpressure with the engine's slot-queue
 *   `highWaterMark`.
 * - Engine errors are surfaced via `destroy(err)` so they propagate as
 *   `'error'` events on the pipeline.
 *
 * @example
 * ```typescript
 * import { LookaheadAsyncIterableTransform } from "replace-content-transformer/node";
 * import { SemaphoreStrategy, searchStrategyFactory } from "replace-content-transformer";
 *
 * const transform = new LookaheadAsyncIterableTransform({
 *   searchStrategy: searchStrategyFactory(["<esi:include", "/>"]),
 *   concurrencyStrategy: new SemaphoreStrategy(8),
 *   replacement: async (match) => {
 *     const { groups: { url } } = /src="(?<url>[^"]+)"/.exec(match)!;
 *     const res = await fetch(url);
 *     return res.body!.pipeThrough(new TextDecoderStream());
 *   }
 * });
 *
 * readable.pipe(transform).pipe(writable);
 * ```
 */
export class LookaheadAsyncIterableTransform<TState, TMatch = string>
  extends Transform
{
  readonly #engine: LookaheadEngine<TState, TMatch>;

  constructor(options: LookaheadAsyncIterableTransformOptions<TState, TMatch>) {
    const transformOptions: TransformOptions = {};
    if (options.streamHighWaterMark !== undefined) {
      transformOptions.highWaterMark = options.streamHighWaterMark;
    }
    super(transformOptions);
    this.#engine = new LookaheadEngine(options, {
      enqueue: (chunk) => this.push(chunk),
      error: (err) =>
        this.destroy(err instanceof Error ? err : new Error(String(err)))
    });
    this.#engine.start();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    this.#engine
      .write(chunk.toString())
      .then(() => callback())
      .catch(callback);
  }

  override _flush(callback: TransformCallback): void {
    this.#engine
      .end()
      .then(() => callback())
      .catch(callback);
  }
}
