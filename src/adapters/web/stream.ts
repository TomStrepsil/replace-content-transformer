import type { TransformEngine } from "../../engines/types.js";
import { ReplaceContentTransformer } from "./transformer.js";
import { countsChunks, HIGH_WATER_MARK, roomInChunks, transformerPair, type RoomFor } from "./transformer-pair.js";

const MAX_UTF8_BYTES_PER_CODE_UNIT = 3;

type EncodedChunk = ReturnType<TextEncoder["encode"]>;

const roomInBytes: RoomFor = (desiredSize) => desiredSize / MAX_UTF8_BYTES_PER_CODE_UNIT;

function roomFor(strategy: QueuingStrategy<EncodedChunk>): RoomFor | undefined {
  if (strategy instanceof ByteLengthQueuingStrategy) return roomInBytes;
  return countsChunks(strategy) ? roomInChunks : undefined;
}

/**
 * A readable/writable pair that replaces content in a UTF-8 byte stream, as
 * {@link ReplaceContentTransformer} does in a `TransformStream`, for
 * `pipeThrough()`. It also applies backpressure within a chunk: once its
 * readable side is full (64 KiB unread, by default), the engine calls no
 * further replacement until no more than half of its `highWaterMark` is left
 * unread, where a `TransformStream` only waits before the next chunk.
 *
 * @example
 * ```typescript
 * import { SerialTransformEngine } from 'replace-content-transformer';
 * import { ReplaceContentStream } from 'replace-content-transformer/web';
 *
 * const replaced = response.body!.pipeThrough(
 *   new ReplaceContentStream(
 *     new SerialTransformEngine({ searchStrategy, replacement: "NEW" })
 *   )
 * );
 * return new Response(replaced, response);
 * ```
 *
 * @remarks Takes and emits bytes as {@link ReplaceContentTransformer} does.
 * Unlike a `TransformStream`, a cancel of its output after its input has
 * ended still cancels the engine.
 */
export class ReplaceContentStream implements ReadableWritablePair<EncodedChunk, Uint8Array> {
  readonly readable: ReadableStream<EncodedChunk>;
  readonly writable: WritableStream<Uint8Array>;

  /**
   * @param engine - The engine to replace content with
   * @param writableStrategy - The writable side's queuing strategy, as for a
   *   `TransformStream`
   * @param readableStrategy - The readable side's queuing strategy, as for a
   *   `TransformStream`. Defaults to a `ByteLengthQueuingStrategy` of 64 KiB.
   *   With a `highWaterMark` of 0, no chunk is passed to the engine, and no
   *   replacement called, while no read is waiting. With a `size()` that
   *   neither counts bytes, as a `ByteLengthQueuingStrategy` does, nor
   *   chunks, as a `CountQueuingStrategy` or no `size()` does,
   *   `SerialTransformEngine` enqueues its output before every replacement.
   */
  constructor(
    engine: TransformEngine,
    writableStrategy?: QueuingStrategy<Uint8Array>,
    readableStrategy: QueuingStrategy<EncodedChunk> = new ByteLengthQueuingStrategy({ highWaterMark: HIGH_WATER_MARK })
  ) {
    ({ readable: this.readable, writable: this.writable } = transformerPair<Uint8Array, EncodedChunk>(
      engine,
      (paced) => new ReplaceContentTransformer(paced),
      writableStrategy,
      readableStrategy,
      roomFor(readableStrategy)
    ));
  }
}
