import { Transform, type TransformOptions } from "node:stream";
import type { TransformEngine } from "../../engines/types.js";

/**
 * Base class for the Node `stream.Transform` adapters in this package.
 *
 * **Encoding**: all subclasses assume UTF-8 input. Node's default
 * `decodeStrings: true` behaviour means any string written to the
 * writable side is converted to a UTF-8 `Buffer` before `_transform`
 * receives it; subclasses call `chunk.toString()` (which decodes as
 * UTF-8) to recover the string. Non-UTF-8 byte streams will be
 * mis-decoded.
 */
export abstract class ReplaceContentTransformBase<T> extends Transform {
  protected readonly engine: TransformEngine<T>;

  constructor(engine: TransformEngine<T>, options?: TransformOptions) {
    super(options);
    this.engine = engine;
    engine.start({
      enqueue: (chunk) => this.push(chunk),
      error: (err) =>
        this.destroy(err instanceof Error ? err : new Error(String(err)))
    });
  }
}
