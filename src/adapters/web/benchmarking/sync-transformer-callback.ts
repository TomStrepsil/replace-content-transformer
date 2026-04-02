import { ReplaceContentTransformerBase } from "../transformer-base.ts";
import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.ts";

export class ReplaceContentTransformerCallback<
  T extends string | Promise<string> = string
> extends ReplaceContentTransformerBase {
  protected processor: SyncCallbackProcessor<T>;

  constructor(processor: SyncCallbackProcessor<T>) {
    super();
    this.processor = processor;
  }

  transform(
    chunk: string,
    controller: TransformStreamDefaultController<T | string>
  ) {
    this.processor.processChunk(chunk, (output) => controller.enqueue(output));
  }

  flush(controller: TransformStreamDefaultController<T | string>) {
    const flushed = this.processor.flush();
    if (flushed) {
      controller.enqueue(flushed);
    }
  }
}
