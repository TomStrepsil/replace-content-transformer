import type { SyncProcessor } from "../../replacement-processors/types.ts";

/**
 * Creates a synchronous transformer for the WHATWG Streams API that replaces content in streaming text.
 *
 * @typeParam T - The output type of the transformer. Use `string` (default) for synchronous replacements,
 *                or `Promise<string>` when using {@link createFunctionReplacementProcessor} with async replacement functions
 *                to enable early discovery of matches while async operations are in flight.
 *
 * @example
 * ```typescript
 * // Default string output
 * const transformer = createReplaceContentTransformer(
 *   createStaticReplacementProcessor({ searchStrategy, replacement: "NEW" })
 * );
 *
 * // Promise<string> output for early discovery
 * const transformer = createReplaceContentTransformer<Promise<string>>(
 *   createFunctionReplacementProcessor<Promise<string>>({
 *     searchStrategy,
 *     replacement: async (match) => await fetch(`/api/${match}`)
 *   })
 * );
 * ```
 */
export function createReplaceContentTransformer<
  T extends string | Promise<string> = string,
>(
  processor: SyncProcessor<T>,
  stopReplacingSignal?: AbortSignal,
): Transformer<string, T | string> {
  return {
    transform(chunk, controller) {
      if (stopReplacingSignal?.aborted) {
        controller.enqueue(chunk);
        return;
      }

      for (const output of processor.processChunk(chunk)) {
        controller.enqueue(output);

        if (stopReplacingSignal?.aborted) {
          break;
        }
      }
    },

    flush(controller) {
      const flushed = processor.flush();
      if (flushed) {
        controller.enqueue(flushed);
      }
    },
  };
}

/**
 * @deprecated Use {@link createReplaceContentTransformer} instead.
 */
export class ReplaceContentTransformer<
  T extends string | Promise<string> = string,
> implements Transformer<string, T | string>
{
  #transformer: Transformer<string, T | string>;

  constructor(processor: SyncProcessor<T>, stopReplacingSignal?: AbortSignal) {
    this.#transformer = createReplaceContentTransformer(
      processor,
      stopReplacingSignal,
    );
  }

  transform(
    chunk: string,
    controller: TransformStreamDefaultController<T | string>,
  ) {
    return this.#transformer.transform!(chunk, controller);
  }

  flush(controller: TransformStreamDefaultController<T | string>) {
    return this.#transformer.flush!(controller);
  }
}
