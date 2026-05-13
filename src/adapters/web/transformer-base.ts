import type { TransformEngine } from "../../engines/types.js";

/**
 * Base class for the WHATWG Streams `Transformer` adapters in this package.
 *
 * **Encoding**: this transformer operates on the decoded strings supplied
 * by the {@link https://streams.spec.whatwg.org/ WHATWG Streams} infrastructure.
 * If the source is a binary `ReadableStream<Uint8Array>` (e.g. `Response.body`),
 * pipe it through {@link TextDecoderStream} before wrapping with
 * {@link TransformStream}:
 * ```typescript
 * response.body
 *   .pipeThrough(new TextDecoderStream())
 *   .pipeThrough(new TransformStream(transformer));
 * ```
 */
export abstract class TransformerBase<
  T extends void | PromiseLike<void>,
  U extends TransformEngine<T>
> implements Transformer<string, string> {
  protected readonly _engine: U;

  constructor(engine: U) {
    this._engine = engine;
  }

  start(controller: TransformStreamDefaultController<string>): void {
    this._engine.start({
      enqueue: (chunk) => controller.enqueue(chunk),
      error: (err) => controller.error(err)
    });
  }

  transform(chunk: string): T {
    return this._engine.write(chunk);
  }
}
