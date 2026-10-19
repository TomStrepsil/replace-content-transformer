import { Transform, type TransformOptions } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { TransformEngine } from "../../engines/types.js";

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

function endsWithHighSurrogate(text: string): boolean {
  const lastCodeUnit = text.charCodeAt(text.length - 1);
  return (
    lastCodeUnit >= HIGH_SURROGATE_MIN && lastCodeUnit <= HIGH_SURROGATE_MAX
  );
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Base class for the Node `stream.Transform` adapters in this package.
 *
 * **Encoding**: `Buffer` chunks are decoded as UTF-8, keeping multi-byte
 * characters intact across chunk boundaries. For other charsets, decode
 * upstream (e.g. with a streaming `TextDecoder`) and write strings with
 * `decodeStrings: false`. With Node's default `decodeStrings: true`, a
 * written string is converted to a `Buffer` using `write()`'s encoding,
 * then decoded as UTF-8. Output is encoded as UTF-8, holding a trailing
 * high surrogate back until the next chunk so a surrogate pair split
 * across output chunks is encoded as one character.
 */
export abstract class TransformBase<T> extends Transform {
  private _runningEngine?: TransformEngine<T>;
  readonly #decoder = new StringDecoder("utf8");
  #heldHighSurrogate = "";

  constructor(engine: TransformEngine<T>, options?: TransformOptions) {
    super(options);
    engine.start({
      enqueue: (chunk) => this.#pushWholeCodePoints(chunk),
      error: (err) => this.destroy(toError(err))
    });
    if (this.destroyed)  {
      engine.cancel?.();
      return;
    }
    this._runningEngine = engine;
  }

  override _destroy(
    err: Error | null,
    callback: (error?: Error | null) => void
  ): void {
    try {
      this._runningEngine?.cancel?.();
    } catch (cancelError) {
      callback(err ?? toError(cancelError));
      return;
    }
    callback(err);
  }

  protected _markEngineEnded(): void {
    this._runningEngine = undefined;
  }

  protected _decode(chunk: Buffer | string): string {
    return typeof chunk === "string"
      ? this.#decoder.end() + chunk
      : this.#decoder.write(chunk);
  }

  protected _decodeRemainder(): string {
    return this.#decoder.end();
  }

  protected _pushHeldHighSurrogate(): void {
    if (this.#heldHighSurrogate) this.push(this.#heldHighSurrogate);
    this.#heldHighSurrogate = "";
  }

  #pushWholeCodePoints(chunk: string): void {
    const text = this.#heldHighSurrogate + chunk;
    const splitsPair = endsWithHighSurrogate(text);
    this.#heldHighSurrogate = splitsPair ? text.slice(-1) : "";
    const wholeCodePoints = splitsPair ? text.slice(0, -1) : text;
    if (wholeCodePoints) this.push(wholeCodePoints);
  }
}
