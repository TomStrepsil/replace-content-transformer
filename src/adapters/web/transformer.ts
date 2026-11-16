import type { TransformEngine } from "../../engines/types.js";
import { TrailingHighSurrogateHold } from "../trailing-high-surrogate-hold.js";

const encoder = new TextEncoder();

type EncodedChunk = ReturnType<TextEncoder["encode"]>;

/**
 * A transformer for the WHATWG Streams API that replaces content in a UTF-8
 * byte stream.
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
 * const replaced = response.body!.pipeThrough(new TransformStream(transformer));
 * return new Response(replaced, response);
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
 * @remarks **Encoding**: input is decoded as UTF-8, keeping multi-byte
 * characters intact across chunk boundaries, so a byte stream such as
 * `Response.body` needs no {@link TextDecoderStream} or
 * {@link TextEncoderStream}. A byte order mark is kept, as are malformed
 * bytes, each decoded as U+FFFD. Output is encoded as UTF-8, holding a
 * trailing high surrogate back until the next chunk so a surrogate pair split
 * across output chunks is encoded as one character. Each chunk the adapter
 * encodes has its own `ArrayBuffer`, so downstream may transfer it.
 *
 * A string chunk errors the stream. For a stream of strings, or one in
 * another encoding (decoded upstream with a {@link TextDecoderStream} for it),
 * use {@link ReplaceContentTextTransformer}.
 */
export class ReplaceContentTransformer implements Transformer<
  Uint8Array,
  EncodedChunk
> {
  readonly #engine: TransformEngine;
  readonly #decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  readonly #hold = new TrailingHighSurrogateHold();
  #controller?: TransformStreamDefaultController<EncodedChunk>;

  constructor(engine: TransformEngine) {
    this.#engine = engine;
  }

  start(controller: TransformStreamDefaultController<EncodedChunk>): void {
    this.#controller = controller;
    this.#engine.start({
      enqueue: (chunk) => this.#enqueueIfAny(this.#hold.wholeCodePoints(chunk)),
      error: (err) => controller.error(err),
      deliveryDeferred: true
    });
  }

  transform(chunk: Uint8Array): void | Promise<void> {
    const text = this.#decoder.decode(chunk, { stream: true });
    return text ? this.#engine.write(text) : undefined;
  }

  flush(): void | Promise<void> {
    const remainder = this.#decoder.decode();
    const written = remainder ? this.#engine.write(remainder) : undefined;
    return written ? written.then(() => this.#end()) : this.#end();
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

  #end(): void | Promise<void> {
    const ended = this.#engine.end();
    return ended
      ? ended.then(() => this.#enqueueHeldHighSurrogate())
      : this.#enqueueHeldHighSurrogate();
  }

  #enqueueHeldHighSurrogate(): void {
    this.#enqueueIfAny(this.#hold.remainder());
  }

  #enqueueIfAny(text: string): void {
    if (text) this.#controller!.enqueue(encoder.encode(text));
  }
}
