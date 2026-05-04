import { ReplaceContentTransformerBase } from "../transformer-base.js";
import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.js";

export class ReplaceContentTransformerCallback extends ReplaceContentTransformerBase {
  protected processor: SyncCallbackProcessor;

  constructor(processor: SyncCallbackProcessor) {
    super();
    this.processor = processor;
  }

  transform(
    chunk: string,
    controller: TransformStreamDefaultController<string>
  ) {
    this.processor.processChunk(chunk, (output) => controller.enqueue(output));
  }

  flush(controller: TransformStreamDefaultController<string>) {
    const flushed = this.processor.flush();
    if (flushed) {
      controller.enqueue(flushed);
    }
  }
}
