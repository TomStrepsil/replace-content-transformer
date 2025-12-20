import { Transform, type TransformCallback } from "node:stream";
import type { Processor } from "../../replacement-processors/types";

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
