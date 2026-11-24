import type { TransformEngine } from "../src/engines/types.ts";
import { utf8 } from "./utilities.ts";
import {
  ReplaceContentStream,
  ReplaceContentTextStream,
  ReplaceContentTextTransformer,
  ReplaceContentTransformer
} from "../src/adapters/web/index.ts";

type Bytes = ReturnType<typeof utf8>;

type WebChunk = string | Bytes;

interface WebAdapter<C extends WebChunk> {
  start(controller: TransformStreamDefaultController<C>): void;
  transform(chunk: C): void | Promise<void>;
  flush(): void | Promise<void>;
  cancel(reason?: unknown): void;
}

interface WebAdapterFamily<C extends WebChunk> {
  adapter: string;
  stream(
    engine: TransformEngine,
    writableStrategy?: QueuingStrategy<C>,
    readableStrategy?: QueuingStrategy<C>
  ): ReadableWritablePair<C, C>;
  chunkOf(text: string): C;
  textOf(chunk: C): string;
  fromBytes(source: ReadableStream<Bytes>): ReadableStream<C>;
}

interface WebTransformerFamily<C extends WebChunk> extends WebAdapterFamily<C> {
  create(engine: TransformEngine): WebAdapter<C>;
}

const bytes = {
  chunkOf: utf8,
  textOf: (chunk: Bytes) => new TextDecoder().decode(chunk),
  fromBytes: (source: ReadableStream<Bytes>) => source
};

const strings = {
  chunkOf: (text: string) => text,
  textOf: (chunk: string) => chunk,
  fromBytes: (source: ReadableStream<Bytes>) => source.pipeThrough(new TextDecoderStream())
};

const byteWebAdapter: WebTransformerFamily<Bytes> = {
  adapter: "ReplaceContentTransformer",
  create: (engine) => new ReplaceContentTransformer(engine),
  stream: (engine, writableStrategy, readableStrategy) =>
    new TransformStream(new ReplaceContentTransformer(engine), writableStrategy, readableStrategy),
  ...bytes
};

const textWebAdapter: WebTransformerFamily<string> = {
  adapter: "ReplaceContentTextTransformer",
  create: (engine) => new ReplaceContentTextTransformer(engine),
  stream: (engine, writableStrategy, readableStrategy) =>
    new TransformStream(new ReplaceContentTextTransformer(engine), writableStrategy, readableStrategy),
  ...strings
};

const byteStreamWebAdapter: WebAdapterFamily<Bytes> = {
  adapter: "ReplaceContentStream",
  stream: (engine, writableStrategy?: QueuingStrategy<Uint8Array>, readableStrategy?) =>
    new ReplaceContentStream(engine, writableStrategy, readableStrategy),
  ...bytes
};

const textStreamWebAdapter: WebAdapterFamily<string> = {
  adapter: "ReplaceContentTextStream",
  stream: (engine, writableStrategy, readableStrategy) =>
    new ReplaceContentTextStream(engine, writableStrategy, readableStrategy),
  ...strings
};

function everyTwoWayByteSplit(text: string): Bytes[][] {
  const bytes = utf8(text);
  return Array.from({ length: bytes.length + 1 }, (_, at) => [
    bytes.subarray(0, at),
    bytes.subarray(at)
  ]);
}

/** A split inside each of a 2-, a 3- and a 4-byte character. */
function midCharacterSplits(): { splitAt: number; chunks: Bytes[] }[] {
  const splits = everyTwoWayByteSplit("£€😀");
  return [1, 3, 6].map((splitAt) => ({ splitAt, chunks: splits[splitAt] }));
}

function byteStreamOf(chunks: Bytes[]): ReadableStream<Bytes> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

/** A stream of `chunks` that never closes, as from a source still producing. */
function unendedByteStreamOf(chunks: Bytes[]): ReadableStream<Bytes> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    }
  });
}

export type { Bytes, WebAdapterFamily, WebChunk, WebTransformerFamily };

export {
  byteStreamOf,
  byteStreamWebAdapter,
  byteWebAdapter,
  everyTwoWayByteSplit,
  midCharacterSplits,
  textStreamWebAdapter,
  textWebAdapter,
  unendedByteStreamOf
};
