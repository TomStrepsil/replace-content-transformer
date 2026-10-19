import type { TransformCallback, TransformOptions } from "node:stream";
import { TransformBase } from "./transform-base.js";
import type { SyncTransformEngine } from "../../engines/types.js";

/**
 * A synchronous Transform stream for Node.js that replaces content in streaming text.
 *
 * Wraps any {@link SyncTransformEngine} (e.g. `SyncReplacementTransformEngine`)
 * as a native `stream.Transform`. Use with `.pipe()` or `stream.pipeline()`.
 *
 * @example
 * ```typescript
 * import { ReplaceContentTransform } from "replace-content-transformer/node";
 * import { SyncReplacementTransformEngine } from "replace-content-transformer";
 *
 * const transform = new ReplaceContentTransform(
 *   new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" })
 * );
 *
 * readableStream.pipe(transform).pipe(writableStream);
 * ```
 *
 * @remarks **Encoding**: all text is processed as UTF-8. See {@link TransformBase}
 * for details.
 */
export class ReplaceContentTransform extends TransformBase<void> {
  readonly #engine: SyncTransformEngine;

  constructor(engine: SyncTransformEngine, options?: TransformOptions) {
    super(engine, options);
    this.#engine = engine;
  }

  override _transform(
    chunk: Buffer | string,
    _encoding: string,
    callback: TransformCallback
  ): void {
    this.#engine.write(this._decode(chunk));
    callback();
  }

  override _flush(callback: TransformCallback): void {
    const remainder = this._decodeRemainder();
    if (remainder) this.#engine.write(remainder);
    this.#engine.end();
    this._markEngineEnded();
    this._pushHeldHighSurrogate();
    callback();
  }
}
