import type { AsyncProcessor } from "../../replacement-processors/types.ts";

/**
 * Compatibility type for the WHATWG `Transformer.cancel` callback.
 *
 * Spec reference: https://streams.spec.whatwg.org/#callbackdef-transformercancelcallback
 * Tracking Node docs/types mismatch: https://github.com/nodejs/node/issues/62540
 */
type CancellableTransformer<I = unknown, O = unknown> = Transformer<I, O> & {
  cancel?: (reason?: unknown) => void | PromiseLike<void>;
};

/**
 * Creates an asynchronous transformer for the WHATWG Streams API that replaces content in streaming text.
 *
 * Uses `for await` to consume the processor's async generator, ensuring each async replacement
 * is resolved before the next is enqueued. This serialises async operations, providing natural
 * back-pressure: the `transform()` method returns a promise that the stream infrastructure awaits
 * before delivering the next input chunk.
 *
 * When the stream is cancelled (readable side cancelled or writable side aborted), the returned
 * transformer's `cancel()` sets an internal flag so that an in-flight `transform()` stops
 * enqueuing at the next yield boundary.
 *
 * **External resource cancellation** — `cancel()` cannot reach into a pending replacement
 * function (e.g. an in-flight `fetch`). To cancel those, share an `AbortController` between
 * your replacement function and the code that tears down the stream:
 *
 * ```typescript
 * const ac = new AbortController();
 *
 * const transformer = createAsyncReplaceContentTransformer(
 *   createAsyncFunctionReplacementProcessor({
 *     searchStrategy,
 *     replacement: async (match) => {
 *       const res = await fetch(`/api/${match}`, { signal: ac.signal });
 *       return res.text();
 *     }
 *   })
 * );
 *
 * // To cancel everything:
 * ac.abort();                       // cancels in-flight fetches
 * await readable.cancel("done");    // tears down the stream → cancel() called
 * ```
 *
 * @example
 * ```typescript
 * // Sequential async replacement (e.g. KV store lookup per match)
 * const transformer = createAsyncReplaceContentTransformer(
 *   createAsyncFunctionReplacementProcessor({
 *     searchStrategy,
 *     replacement: async (match) => {
 *       return (await kv.get(match)) ?? "";
 *     }
 *   })
 * );
 *
 * // Async iterable replacement (e.g. streaming fetch body into output)
 * const transformer = createAsyncReplaceContentTransformer(
 *   createAsyncIterableFunctionReplacementProcessor({
 *     searchStrategy,
 *     replacement: async (match) => {
 *       const res = await fetch(`/api/${match}`);
 *       return res.body!.pipeThrough(new TextDecoderStream());
 *     }
 *   })
 * );
 * ```
 */
export function createAsyncReplaceContentTransformer(
  processor: AsyncProcessor,
  stopReplacingSignal?: AbortSignal,
): CancellableTransformer<string, string> {
  let cancelled = false;

  return {
    async transform(chunk, controller) {
      if (stopReplacingSignal?.aborted) {
        controller.enqueue(chunk);
        return;
      }

      for await (const output of processor.processChunk(chunk)) {
        if (cancelled) return;
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

    cancel() {
      cancelled = true;
    },
  };
}

/**
 * @deprecated Use {@link createAsyncReplaceContentTransformer} instead.
 */
export class AsyncReplaceContentTransformer
  implements Transformer<string, string>
{
  #transformer: CancellableTransformer<string, string>;

  constructor(processor: AsyncProcessor, stopReplacingSignal?: AbortSignal) {
    this.#transformer = createAsyncReplaceContentTransformer(
      processor,
      stopReplacingSignal,
    );
  }

  transform(
    chunk: string,
    controller: TransformStreamDefaultController<string>,
  ) {
    return this.#transformer.transform!(chunk, controller);
  }

  flush(controller: TransformStreamDefaultController<string>) {
    return this.#transformer.flush!(controller);
  }

  cancel(reason?: unknown) {
    return this.#transformer.cancel!(reason);
  }
}
