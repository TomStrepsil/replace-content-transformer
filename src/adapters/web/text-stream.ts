import type { TransformEngine } from "../../engines/types.js";
import { ReplaceContentTextTransformer } from "./text-transformer.js";
import { HIGH_WATER_MARK, transformerPair } from "./transformer-pair.js";

const codeUnitsStrategy: QueuingStrategy<string> = { highWaterMark: HIGH_WATER_MARK, size: (chunk) => chunk!.length };

/**
 * A readable/writable pair that replaces content in a stream of strings, as
 * {@link ReplaceContentTextTransformer} does in a `TransformStream`, for
 * `pipeThrough()`. It also applies backpressure within a chunk: once its
 * readable side is full (65,536 code units unread, by default), the engine
 * calls no further replacement until no more than half of its
 * `highWaterMark` is left unread, where a `TransformStream` only waits before
 * the next chunk.
 *
 * @example
 * ```typescript
 * import { SerialTransformEngine } from 'replace-content-transformer';
 * import { ReplaceContentTextStream } from 'replace-content-transformer/web';
 *
 * const replaced = tokenStream.pipeThrough(
 *   new ReplaceContentTextStream(
 *     new SerialTransformEngine({ searchStrategy, replacement: "NEW" })
 *   )
 * );
 * ```
 *
 * @remarks Unlike a `TransformStream`, a cancel of its output after its
 * input has ended still cancels the engine.
 */
export class ReplaceContentTextStream implements ReadableWritablePair<string, string> {
  readonly readable: ReadableStream<string>;
  readonly writable: WritableStream<string>;

  /**
   * @param engine - The engine to replace content with
   * @param writableStrategy - The writable side's queuing strategy, as for a
   *   `TransformStream`
   * @param readableStrategy - The readable side's queuing strategy, as for a
   *   `TransformStream`. Defaults to 65,536 code units, sized by string
   *   length. With a `highWaterMark` of 0, no chunk is passed to the engine,
   *   and no replacement called, while no read is waiting. With a `size()` of
   *   your own other than one that counts chunks, as a
   *   `CountQueuingStrategy` or no `size()` does, `SerialTransformEngine`
   *   enqueues its output before every replacement.
   */
  constructor(
    engine: TransformEngine,
    writableStrategy?: QueuingStrategy<string>,
    readableStrategy: QueuingStrategy<string> = codeUnitsStrategy
  ) {
    ({ readable: this.readable, writable: this.writable } = transformerPair<string, string>(
      engine,
      (paced) => new ReplaceContentTextTransformer(paced),
      writableStrategy,
      readableStrategy,
      readableStrategy === codeUnitsStrategy ? 1 : undefined
    ));
  }
}
