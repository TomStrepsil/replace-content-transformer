import { ReplaceContentTransformerBase } from "../transformer-base.ts";
import type { AsyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.ts";

export class AsyncReplaceContentTransformerCallback extends ReplaceContentTransformerBase {
  protected processor: AsyncCallbackProcessor;

  constructor(processor: AsyncCallbackProcessor) {
    super();
    this.processor = processor;
  }

  async transform(
    chunk: string,
    controller: TransformStreamDefaultController<string>
  ) {
    await this.processor.processChunk(chunk, (output) =>
      controller.enqueue(output)
    );
  }

  flush(controller: TransformStreamDefaultController<string>) {
    const flushed = this.processor.flush();
    if (flushed) {
      controller.enqueue(flushed);
    }
  }
}
