import { ReplaceContentTransformerBase } from "./transformer-base.ts";
import type { AsyncProcessor } from "../../replacement-processors/types.ts";

/**
 * An asynchronous transformer for the WHATWG Streams API that replaces content in streaming text.
 *
 * Uses `for await` to consume the processor's async generator, ensuring each async replacement
 * is resolved before the next is enqueued. This serialises async operations, providing natural
 * back-pressure: the `transform()` method returns a promise that the stream infrastructure awaits
 * before delivering the next input chunk.
 *
 * @example
 * ```typescript
 * // Sequential async replacement (e.g. KV store lookup per match)
 * const transformer = new AsyncReplaceContentTransformer(
 *   new AsyncFunctionReplacementProcessor({
 *     searchStrategy,
 *     replacement: async (match) => {
 *       return (await kv.get(match)) ?? "";
 *     }
 *   })
 * );
 *
 * // Async iterable replacement (e.g. streaming fetch body into output)
 * const transformer = new AsyncReplaceContentTransformer(
 *   new AsyncIterableFunctionReplacementProcessor({
 *     searchStrategy,
 *     replacement: async (match) => {
 *       const res = await fetch(`/api/${match}`);
 *       return res.body!.pipeThrough(new TextDecoderStream());
 *     }
 *   })
 * );
 * ```
 */
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
