import {
  Transform,
  type TransformCallback,
  type TransformOptions
} from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { TransformEngine } from "../../engines/types.js";
import endsWithHighSurrogate from "./ends-with-high-surrogate.js";

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
 *     replacement: async (match) => {
 *       const res = await fetch(`/api/${match}`);
 *       return res.body!.pipeThrough(new TextDecoderStream());
 *     }
 *   })
 * );
 * ```
 *
 * @remarks **Encoding**: `Buffer` chunks are decoded as UTF-8, keeping
 * multi-byte characters intact across chunk boundaries. For other charsets,
 * decode upstream (e.g. with a streaming `TextDecoder`) and write strings
 * with `decodeStrings: false`. With Node's default `decodeStrings: true`, a
 * written string is converted to a `Buffer` using `write()`'s encoding, then
 * decoded as UTF-8. Output is encoded as UTF-8, holding a trailing high
 * surrogate back until the next chunk so a surrogate pair split across
 * output chunks is encoded as one character.
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
  #heldHighSurrogate = "";
  private _engineRunning?: boolean;

  constructor(engine: TransformEngine, options?: TransformOptions) {
    super(options);
    this.#engine = engine;
    engine.start({
      enqueue: (chunk) => this.#pushWholeCodePoints(chunk),
      error: (err) => this.destroy(toError(err))
    });
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
    if (this.#heldHighSurrogate) this.push(this.#heldHighSurrogate);
    this.#heldHighSurrogate = "";
    callback();
  }

  #decode(chunk: Buffer | string): string {
    return typeof chunk === "string"
      ? this.#decoder.end() + chunk
      : this.#decoder.write(chunk);
  }

  #pushWholeCodePoints(chunk: string): void {
    const text = this.#heldHighSurrogate + chunk;
    const splitsPair = endsWithHighSurrogate(text);
    this.#heldHighSurrogate = splitsPair ? text.slice(-1) : "";
    const wholeCodePoints = splitsPair ? text.slice(0, -1) : text;
    if (wholeCodePoints) this.push(wholeCodePoints);
  }
}
