import { Transform, type TransformOptions } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { TransformEngine } from "../../engines/types.js";

/**
 * Base class for the Node `stream.Transform` adapters in this package.
 *
 * **Encoding**: `Buffer` chunks are decoded as UTF-8, keeping multi-byte
 * characters intact across chunk boundaries. For other charsets, decode
 * upstream (e.g. with a streaming `TextDecoder`) and write strings with
 * `decodeStrings: false`. With Node's default `decodeStrings: true`, a
 * written string is converted to a `Buffer` using `write()`'s encoding,
 * then decoded as UTF-8.
 */
export abstract class TransformBase<T> extends Transform {
  protected readonly _engine: TransformEngine<T>;
  readonly #decoder = new StringDecoder("utf8");

  constructor(engine: TransformEngine<T>, options?: TransformOptions) {
    super(options);
    this._engine = engine;
    engine.start({
      enqueue: (chunk) => this.push(chunk),
      error: (err) =>
        this.destroy(err instanceof Error ? err : new Error(String(err)))
    });
  }

  protected _decode(chunk: Buffer | string): string {
    return typeof chunk === "string"
      ? this.#decoder.end() + chunk
      : this.#decoder.write(chunk);
  }

  protected _decodeRemainder(): string {
    return this.#decoder.end();
  }
}
