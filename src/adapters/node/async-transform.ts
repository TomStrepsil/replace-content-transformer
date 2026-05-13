import type { TransformCallback, TransformOptions } from "node:stream";
import { TransformBase } from "./transform-base.js";
import type { AsyncTransformEngine } from "../../engines/types.js";

/**
 * An asynchronous Transform stream for Node.js that replaces content in streaming text.
 *
 * Wraps any {@link AsyncTransformEngine} (e.g. `AsyncSerialReplacementTransformEngine`
 * or `AsyncLookaheadTransformEngine`) as a native `stream.Transform`. Use with
 * `.pipe()` or `stream.pipeline()`.
 *
 * @example
 * ```typescript
 * import { AsyncReplaceContentTransform } from "replace-content-transformer/node";
 * import { AsyncSerialReplacementTransformEngine } from "replace-content-transformer";
 *
 * const transform = new AsyncReplaceContentTransform(
 *   new AsyncSerialReplacementTransformEngine({
 *     searchStrategy,
 *     replacement: async (match) => (await kv.get(match)) ?? ""
 *   })
 * );
 *
 * readableStream.pipe(transform).pipe(writableStream);
 * ```
 *
 * @remarks **Encoding**: all text is processed as UTF-8. See {@link TransformBase}
 * for details.
 *
 * @example Lookahead replacement
 * ```typescript
 * const transform = new AsyncReplaceContentTransform(
 *   new AsyncLookaheadTransformEngine({
 *     searchStrategy,
 *     concurrencyStrategy: new SemaphoreStrategy(8),
 *     replacement: async (match) => {
 *       const res = await fetch(`/api/${match}`);
 *       return res.body!.pipeThrough(new TextDecoderStream());
 *     }
 *   })
 * );
 * ```
 */
export class AsyncReplaceContentTransform extends TransformBase<
  Promise<void>
> {
  readonly #engine: AsyncTransformEngine;

  constructor(engine: AsyncTransformEngine, options?: TransformOptions) {
    super(engine, options);
    this.#engine = engine;
  }

  override _transform(
    chunk: Buffer,
    _encoding: string,
    callback: TransformCallback
  ): void {
    this.#engine
      .write(chunk.toString())
      .then(() => callback())
      .catch(callback);
  }

  override _flush(callback: TransformCallback): void {
    Promise.resolve(this.#engine.end() as void | Promise<void>)
      .then(() => callback())
      .catch(callback);
  }
}
