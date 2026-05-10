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
 */
export class ReplaceContentTransform extends TransformBase<void> {
  readonly #engine: SyncTransformEngine;

  constructor(engine: SyncTransformEngine, options?: TransformOptions) {
    super(engine, options);
    this.#engine = engine;
  }

  override _transform(
    chunk: Buffer,
    _encoding: string,
    callback: TransformCallback
  ): void {
    this.#engine.write(chunk.toString());
    callback();
  }

  override _flush(callback: TransformCallback): void {
    this.#engine.end();
    callback();
  }
}
