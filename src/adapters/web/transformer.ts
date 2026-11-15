import type { TransformEngine } from "../../engines/types.js";

/**
 * A transformer for the WHATWG Streams API that replaces content in
 * streaming text.
 *
 * Takes a {@link TransformEngine}: `SerialTransformEngine` for string,
 * iterable, static or serial async replacements, or
 * `LookaheadTransformEngine` for concurrent pipelined replacements with
 * pluggable concurrency control.
 *
 * @example
 * ```typescript
 * import { SerialTransformEngine } from 'replace-content-transformer';
 * import { ReplaceContentTransformer } from 'replace-content-transformer/web';
 *
 * const transformer = new ReplaceContentTransformer(
 *   new SerialTransformEngine({ searchStrategy, replacement: "NEW" })
 * );
 * const stream = new TransformStream(transformer);
 * ```
 *
 * @example Async replacement
 * ```typescript
 * const transformer = new ReplaceContentTransformer(
 *   new SerialTransformEngine({
 *     searchStrategy,
 *     replacement: async (match) => (await kv.get(match)) ?? ""
 *   })
 * );
 * ```
 *
 * @example Pipelined lookahead replacement
 * ```typescript
 * const transformer = new ReplaceContentTransformer(
 *   new LookaheadTransformEngine({
 *     searchStrategy,
 *     replacement: async (match) => {
 *       const res = await fetch(`/api/${match}`);
 *       return res.body!.pipeThrough(new TextDecoderStream());
 *     },
 *     concurrencyStrategy: new SemaphoreStrategy(8)
 *   })
 * );
 * ```
 *
 * @remarks **Encoding**: this transformer operates on the decoded strings
 * supplied by the {@link https://streams.spec.whatwg.org/ WHATWG Streams}
 * infrastructure. If the source is a binary `ReadableStream<Uint8Array>`
 * (e.g. `Response.body`), pipe it through {@link TextDecoderStream} before
 * wrapping with {@link TransformStream}:
 * ```typescript
 * response.body!
 *   .pipeThrough(new TextDecoderStream())
 *   .pipeThrough(new TransformStream(transformer));
 * ```
 */
export class ReplaceContentTransformer implements Transformer<string, string> {
  readonly #engine: TransformEngine;

  constructor(engine: TransformEngine) {
    this.#engine = engine;
  }

  start(controller: TransformStreamDefaultController<string>): void {
    this.#engine.start({
      enqueue: (chunk) => controller.enqueue(chunk),
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
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- an optional reason is part of the WHATWG callback signature; accepted for compatibility and unused in this implementation
  cancel(reason?: unknown): void {
    this.#engine.cancel?.();
  }
}
