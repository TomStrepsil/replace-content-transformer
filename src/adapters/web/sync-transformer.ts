import { ReplaceContentTransformerBase } from "./transformer-base.ts";
import type { SyncProcessor } from "../../replacement-processors/types.ts";

/**
 * A synchronous transformer for the WHATWG Streams API that replaces content in streaming text.
 *
 * @typeParam T - The output type of the transformer. Use `string` (default) for synchronous replacements,
 *                or `Promise<string>` when using FunctionReplacementProcessor with async replacement functions
 *                to enable early discovery of matches while async operations are in flight.
 *
 * @example
 * ```typescript
 * // Default string output
 * const transformer = new ReplaceContentTransformer(
 *   new StaticReplacementProcessor({ searchStrategy, replacement: "NEW" })
 * );
 *
 * // Promise<string> output for early discovery
 * const transformer = new ReplaceContentTransformer<Promise<string>>(
 *   new FunctionReplacementProcessor<Promise<string>>({
 *     searchStrategy,
 *     replacement: async (match) => await fetch(`/api/${match}`)
 *   })
 * );
 * ```
 */
export class ReplaceContentTransformer<
  T extends string | Promise<string> = string
> extends ReplaceContentTransformerBase<T> {
  protected processor: SyncProcessor<T>;
  #stopReplacingSignal?: AbortSignal;

  constructor(processor: SyncProcessor<T>, stopReplacingSignal?: AbortSignal) {
    super();
    this.#stopReplacingSignal = stopReplacingSignal;
    this.processor = processor;
  }

  transform(
    chunk: string,
    controller: TransformStreamDefaultController<T | string>
  ) {
    if (this.#stopReplacingSignal?.aborted) {
      controller.enqueue(chunk);
      return;
    }

    for (const output of this.processor.processChunk(chunk)) {
      controller.enqueue(output);

      if (this.#stopReplacingSignal?.aborted) {
        break;
      }
    }
  }
}
