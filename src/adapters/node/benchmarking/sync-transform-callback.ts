import { ReplaceContentTransformBase } from "../transform-base";
import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types";

export class ReplaceContentTransformCallback extends ReplaceContentTransformBase {
  protected processor: SyncCallbackProcessor;

  constructor(processor: SyncCallbackProcessor) {
    super({
      transform: (chunk: Buffer | string, _encoding: string, callback) => {
        this.processor.processChunk(chunk.toString(), (output) =>
          this.push(output)
        );
        callback();
      },
      flush: (callback) => this.flush(callback)
    });
    this.processor = processor;
  }
}
