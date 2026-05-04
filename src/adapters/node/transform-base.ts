import { Transform, type TransformCallback } from "node:stream";
import type { Processor } from "../../replacement-processors/types.js";

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
export abstract class ReplaceContentTransformBase extends Transform {
  protected abstract processor: Processor;

  protected flush(callback: TransformCallback) {
    const flushed = this.processor.flush();
    if (flushed) {
      this.push(flushed);
    }
    callback();
  }
}
