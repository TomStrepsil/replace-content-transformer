import { ReplaceContentTransformBase } from "../transform-base.ts";
import type { AsyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.ts";

export class AsyncReplaceContentTransformCallback extends ReplaceContentTransformBase {
  protected processor: AsyncCallbackProcessor;

  constructor(processor: AsyncCallbackProcessor) {
    super({
      transform: async (
        chunk: Buffer | string,
        _encoding: string,
        callback
      ) => {
        await this.processor.processChunk(chunk.toString(), (output) =>
          this.push(output)
        );
        callback();
      },
      flush: (callback) => this.flush(callback)
    });
    this.processor = processor;
  }
}
