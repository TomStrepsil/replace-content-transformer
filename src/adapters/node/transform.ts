import {
  Transform,
  type TransformCallback,
  type TransformOptions
} from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { TransformEngine, Utf8Bytes } from "../../engines/types.js";
import { BYTE_ORDER_MARK } from "../../byte-order-mark.js";
import { ByteOrderMarkBypass } from "../byte-order-mark-bypass.js";
import { TrailingHighSurrogateHold } from "../trailing-high-surrogate-hold.js";

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const END_OF_STREAM = Symbol("end of stream");

function cancelEngine(engine?: TransformEngine): Error | undefined {
  try {
    engine?.cancel?.();
  } catch (cancelError) {
    return toError(cancelError);
  }
}

/**
 * A Transform stream for Node.js that replaces content in streaming text.
 *
 * Wraps a {@link TransformEngine} (`SerialTransformEngine` or
 * `LookaheadTransformEngine`) as a native `stream.Transform`. Use with
 * `.pipe()` or `stream.pipeline()`. A chunk the engine processes
 * synchronously completes synchronously; one it processes asynchronously
 * completes when the engine's `Promise` settles. An error the engine throws
 * or rejects with destroys the stream with that error.
 *
 * @example
 * ```typescript
 * import { ReplaceContentTransform } from "replace-content-transformer/node";
 * import { SerialTransformEngine } from "replace-content-transformer";
 *
 * const transform = new ReplaceContentTransform(
 *   new SerialTransformEngine({ searchStrategy, replacement: "NEW" })
 * );
 *
 * readableStream.pipe(transform).pipe(writableStream);
 * ```
 *
 * @example Async replacement
 * ```typescript
 * const transform = new ReplaceContentTransform(
 *   new SerialTransformEngine({
 *     searchStrategy,
 *     replacement: async (match) => (await kv.get(match)) ?? ""
 *   })
 * );
 * ```
 *
 * @example Lookahead replacement
 * ```typescript
 * const transform = new ReplaceContentTransform(
 *   new LookaheadTransformEngine({
 *     searchStrategy,
 *     concurrencyStrategy: new SemaphoreStrategy(8),
 *     replacement: async (match) => (await fetch(`/api/${match}`)).body!
 *   })
 * );
 * ```
 *
 * @remarks **Encoding**: `Buffer` chunks are decoded as UTF-8, keeping
 * multi-byte characters intact across chunk boundaries. For other charsets,
 * decode upstream (e.g. with a streaming `TextDecoder`) and write strings
 * with `decodeStrings: false`. With Node's default `decodeStrings: true`, a
 * written string is converted to a `Buffer` using `write()`'s encoding, then
 * decoded as UTF-8. A byte order mark at the start of the input the adapter
 * decodes is kept at the start of the output but not searched; a string
 * written with `decodeStrings: false` is searched as written. Output is
 * encoded as UTF-8, holding a trailing high surrogate back until the next
 * chunk so a surrogate pair split across output chunks is encoded as one
 * character. Bytes a replacement produces asynchronously, such as the chunks
 * of a `fetch` response body, are pushed without being decoded and encoded
 * again, once the engine has checked they are valid UTF-8. They are copied,
 * so a replacement may reuse its buffer for its next chunk. With
 * `readableObjectMode`, output is strings only: bytes a replacement produces
 * are decoded as UTF-8.
 *
 * @remarks **Stopping on output**: destroying the stream cancels the engine.
 * A consumer that destroys it on receiving some output prevents any later
 * replacement only if it receives that output as it is produced, which needs
 * an engine that enqueues output as it is produced (`SerialTransformEngine`
 * with a `stopReplacingSignal`), and a stream that is flowing with nothing
 * buffered. While the consumer is behind or not yet reading, output is
 * buffered, and later replacements may be called before it is read.
 */
export class ReplaceContentTransform extends Transform {
  readonly #engine: TransformEngine;
  readonly #decoder = new StringDecoder("utf8");
  readonly #hold = new TrailingHighSurrogateHold();
  readonly #byteOrderMark = new ByteOrderMarkBypass(() =>
    this.push(BYTE_ORDER_MARK)
  );
  private _engineRunning?: boolean;

  constructor(engine: TransformEngine, options?: TransformOptions) {
    super(options);
    this.#engine = engine;
    const enqueue = (chunk: string | Utf8Bytes) => {
      if (typeof chunk === "string") this.#pushIfAny(this.#hold.wholeCodePoints(chunk));
      else this.#pushBytes(chunk);
    };
    const error = (err: unknown) => this.destroy(toError(err));
    engine.start({ enqueue, error, acceptsBytes: !this.readableObjectMode });
    if (this.destroyed) {
      cancelEngine(engine);
      return;
    }
    this._engineRunning = true;
  }

  override _transform(
    chunk: Buffer | string,
    _encoding: string,
    callback: TransformCallback
  ): void {
    this.#call(this.#decode(chunk), callback, callback);
  }

  override _flush(callback: TransformCallback): void {
    const remainder = this.#decoder.end();
    const end = () =>
      this.#call(END_OF_STREAM, callback, () => this.#finish(callback));
    if (remainder) this.#call(remainder, callback, end);
    else end();
  }

  override _destroy(
    err: Error | null,
    callback: (error?: Error | null) => void
  ): void {
    const cancelError = this._engineRunning ? cancelEngine(this.#engine) : undefined;
    callback(err ?? cancelError);
  }

  #call(
    chunk: string | typeof END_OF_STREAM,
    callback: TransformCallback,
    next: () => void
  ): void {
    let result: void | Promise<void>;
    try {
      result =
        chunk === END_OF_STREAM ? this.#engine.end() : this.#engine.write(chunk);
    } catch (error) {
      callback(toError(error));
      return;
    }
    if (result === undefined) next();
    else
      result
        .then(() => next())
        .catch((error: unknown) => callback(toError(error)));
  }

  #finish(callback: TransformCallback): void {
    this._engineRunning = false;
    this.#pushIfAny(this.#hold.remainder());
    callback();
  }

  #decode(chunk: Buffer | string): string {
    return typeof chunk === "string"
      ? this.#byteOrderMark.textDecodedUpstream(this.#decoder.end() + chunk)
      : this.#byteOrderMark.textForEngine(this.#decoder.write(chunk));
  }

  #pushBytes(bytes: Utf8Bytes): void {
    this.#pushIfAny(this.#hold.remainder());
    this.push(Buffer.from(bytes));
  }

  #pushIfAny(text: string): void {
    if (text) this.push(text);
  }
}
