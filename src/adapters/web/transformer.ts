import type { ByteEngineSink, TransformEngine, Utf8Bytes } from "../../engines/types.js";
import { BYTE_ORDER_MARK } from "../../byte-order-mark.js";
import { ByteOrderMarkBypass } from "../byte-order-mark-bypass.js";
import { TrailingHighSurrogateHold } from "../trailing-high-surrogate-hold.js";
import { enqueueOrCancel } from "./enqueue-or-cancel.js";

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
 *     replacement: async (match) => (await fetch(`/api/${match}`)).body!,
 *     concurrencyStrategy: new SemaphoreStrategy(8)
 *   })
 * );
 * ```
 *
 * @remarks **Encoding**: input is decoded as UTF-8, keeping multi-byte
 * characters intact across chunk boundaries, so a byte stream such as
 * `Response.body` needs no {@link TextDecoderStream} or
 * {@link TextEncoderStream}. A byte order mark at the start of the input is
 * kept at the start of the output but not searched, so the engine sees the
 * text a {@link TextDecoderStream} would decode. Malformed bytes are each
 * decoded as U+FFFD. Output is encoded as UTF-8, holding a
 * trailing high surrogate back until the next chunk so a surrogate pair split
 * across output chunks is encoded as one character.
 *
 * Bytes a replacement produces asynchronously, such as the chunks of a
 * `fetch` response body, are emitted without being decoded and encoded
 * again, once the engine has checked they are valid UTF-8. They are copied,
 * so a replacement may reuse its buffer for its next chunk. Each chunk has
 * its own `ArrayBuffer`, so downstream may transfer it.
 *
 * A string chunk errors the stream. For a stream of strings, or one in
 * another encoding (decoded upstream with a {@link TextDecoderStream} for it),
 * use {@link ReplaceContentTextTransformer}.
 *
 * @remarks **Backpressure**: a `TransformStream` waits for its output to be
 * read only before passing the next chunk, so every match in a chunk is
 * replaced whether or not the output is being read. To stop replacing while
 * it isn't, use {@link ReplaceContentStream}.
 */
export class ReplaceContentTransformer implements Transformer<
  Uint8Array,
  EncodedChunk
> {
  readonly #engine: TransformEngine;
  readonly #decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  readonly #hold = new TrailingHighSurrogateHold();
  readonly #byteOrderMark = new ByteOrderMarkBypass(() =>
    this.#enqueue(encoder.encode(BYTE_ORDER_MARK))
  );
  #controller?: Pick<TransformStreamDefaultController<EncodedChunk>, "enqueue">;

  constructor(engine: TransformEngine) {
    this.#engine = engine;
  }

  start(controller: Pick<TransformStreamDefaultController<EncodedChunk>, "enqueue" | "error">): void {
    this.#controller = controller;
    const sink: ByteEngineSink = {
      enqueue: (chunk) => {
        if (typeof chunk === "string") this.#enqueueIfAny(this.#hold.wholeCodePoints(chunk));
        else this.#enqueueBytes(chunk);
      },
      error: (err) => controller.error(err),
      deliveryDeferred: true,
      acceptsBytes: true
    };
    this.#engine.start(sink);
  }

  transform(chunk: Uint8Array): void | Promise<void> {
    const text = this.#byteOrderMark.textForEngine(
      this.#decoder.decode(chunk, { stream: true })
    );
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
   * Once the input has ended, a `TransformStream` no longer calls this: a
   * cancel waits for `flush()` instead. The stream pairs still call it.
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

  #enqueueBytes(bytes: Utf8Bytes): void {
    if (this.#enqueueIfAny(this.#hold.remainder())) this.#enqueue(new Uint8Array(bytes));
  }

  #enqueueIfAny(text: string): boolean {
    return !text || this.#enqueue(encoder.encode(text));
  }

  #enqueue(chunk: EncodedChunk): boolean {
    return enqueueOrCancel(this.#controller!, this.#engine, chunk);
  }
}
