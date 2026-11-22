import type { TransformEngine } from "../../engines/types.js";
import { enqueueOrCancel } from "./enqueue-or-cancel.js";

/**
 * A transformer for the WHATWG Streams API that replaces content in a stream
 * of strings.
 *
 * Takes a {@link TransformEngine}: `SerialTransformEngine` for string,
 * iterable, static or serial async replacements, or
 * `LookaheadTransformEngine` for concurrent pipelined replacements with
 * pluggable concurrency control.
 *
 * @example
 * ```typescript
 * import { SerialTransformEngine } from 'replace-content-transformer';
 * import { ReplaceContentTextTransformer } from 'replace-content-transformer/web';
 *
 * const transformer = new ReplaceContentTextTransformer(
 *   new SerialTransformEngine({ searchStrategy, replacement: "NEW" })
 * );
 * const replaced = tokenStream.pipeThrough(new TransformStream(transformer));
 * ```
 *
 * @remarks **Encoding**: use this where the source is already strings, such
 * as a token stream or another text transform. For a byte source, such as
 * `Response.body`, use {@link ReplaceContentTransformer}, which decodes and
 * encodes UTF-8 itself. For a source in another encoding, decode it with a
 * {@link TextDecoderStream} for that encoding:
 * ```typescript
 * response.body!
 *   .pipeThrough(new TextDecoderStream("shift_jis"))
 *   .pipeThrough(new TransformStream(transformer));
 * ```
 * With the regex search strategy, string chunks must not split a surrogate
 * pair. A `TextDecoder` or `TextDecoderStream` never does.
 */
export class ReplaceContentTextTransformer implements Transformer<string, string> {
  readonly #engine: TransformEngine;

  constructor(engine: TransformEngine) {
    this.#engine = engine;
  }

  start(controller: TransformStreamDefaultController<string>): void {
    this.#engine.start({
      enqueue: (chunk) => enqueueOrCancel(controller, this.#engine, chunk),
      error: (err) => controller.error(err),
      deliveryDeferred: true
    });
  }

  transform(chunk: string): void | Promise<void> {
    return this.#engine.write(chunk);
  }

  flush(): void | Promise<void> {
    return this.#engine.end();
  }

  /**
   * Called by the stream infrastructure when the readable side is cancelled
   * or the writable side is aborted. Forwards to the engine's cancel() if
   * present so in-flight async work can stop at the next yield boundary.
   * Once the input has ended, the stream no longer calls this: a cancel waits
   * for `flush()` instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- an optional reason is part of the WHATWG callback signature; accepted for compatibility and unused in this implementation
  cancel(reason?: unknown): void {
    this.#engine.cancel?.();
  }
}
