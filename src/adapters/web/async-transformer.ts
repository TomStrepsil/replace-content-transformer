import { ReplaceContentTransformerBase } from "./transformer-base.ts";
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
export class AsyncReplaceContentTransformer
  extends ReplaceContentTransformerBase<string>
  implements CancellableTransformer<string, string>
{
  protected processor: AsyncProcessor;
  #stopReplacingSignal?: AbortSignal;
  #cancelled = false;

  constructor(processor: AsyncProcessor, stopReplacingSignal?: AbortSignal) {
    super();
    this.#stopReplacingSignal = stopReplacingSignal;
    this.processor = processor;
  }

  async transform(
    chunk: string,
    controller: TransformStreamDefaultController<string>
  ) {
    if (this.#cancelled) {
      return;
    }

    if (this.#stopReplacingSignal?.aborted) {
      controller.enqueue(chunk);
      return;
    }

    for await (const output of this.processor.processChunk(chunk)) {
      if (this.#cancelled) return;

      controller.enqueue(output);

      if (this.#stopReplacingSignal?.aborted) {
        break;
      }
    }
  }

  /**
   * Called by the stream infrastructure when the readable side is cancelled or
   * the writable side is aborted. Sets an internal flag so that an in-flight
   * async {@link AsyncReplaceContentTransformer.transform | transform()} can
   * stop enqueuing at the next yield boundary.
   *
   * **External resource cancellation** — `cancel()` cannot reach into a
   * pending replacement function (e.g. an in-flight `fetch`). To cancel
   * those, share an `AbortController` between your replacement function and
   * the code that tears down the stream:
   *
   * ```typescript
   * const ac = new AbortController();
   *
   * const transformer = new AsyncReplaceContentTransformer(
   *   new AsyncFunctionReplacementProcessor({
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
   * @param reason Optional cancellation reason from the stream infrastructure.
   * Accepted for WHATWG callback compatibility and intentionally unused.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reason is a required part of the WHATWG callback signature, but unused in this implementation
  cancel(reason?: unknown): void {
    this.#cancelled = true;
  }
}
