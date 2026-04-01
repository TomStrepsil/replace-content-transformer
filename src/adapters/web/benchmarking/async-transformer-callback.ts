import type { Transformer } from "node:stream/web";
import type { AsyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.ts";

export function createAsyncReplaceContentTransformerCallback(
  processor: AsyncCallbackProcessor,
): Transformer<string, string> {
  return {
    async transform(chunk, controller) {
      await processor.processChunk(chunk, (output) =>
        controller.enqueue(output)
      );
    },

    flush(controller) {
      const flushed = processor.flush();
      if (flushed) {
        controller.enqueue(flushed);
      }
    },
  };
}
