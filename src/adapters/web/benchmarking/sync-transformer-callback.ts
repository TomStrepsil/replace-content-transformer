import type { Transformer } from "node:stream/web";
import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.ts";

export function createReplaceContentTransformerCallback<
  T extends string | Promise<string> = string,
>(
  processor: SyncCallbackProcessor<T>,
): Transformer<string, T | string> {
  return {
    transform(chunk, controller) {
      processor.processChunk(chunk, (output) => controller.enqueue(output));
    },

    flush(controller) {
      const flushed = processor.flush();
      if (flushed) {
        controller.enqueue(flushed);
      }
    },
  };
}
