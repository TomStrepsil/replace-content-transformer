import { ReplaceContentTransformerBase } from "./transformer-base.ts";
import type { AsyncProcessor } from "../../replacement-processors/types.ts";

export class AsyncReplaceContentTransformer extends ReplaceContentTransformerBase {
  protected processor: AsyncProcessor;
  #stopReplacingSignal?: AbortSignal;

  constructor(processor: AsyncProcessor, stopReplacingSignal?: AbortSignal) {
    super();
    this.#stopReplacingSignal = stopReplacingSignal;
    this.processor = processor;
  }

  async transform(
    chunk: string,
    controller: TransformStreamDefaultController<string>
  ) {
    if (this.#stopReplacingSignal?.aborted) {
      controller.enqueue(chunk);
      return;
    }

    for await (const output of this.processor.processChunk(chunk)) {
      controller.enqueue(output);

      if (this.#stopReplacingSignal?.aborted) {
        break;
      }
    }
  }
}
