import type { TransformEngine } from "../src/engines/types.ts";
import { utf8 } from "./utilities.ts";
import {
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
  create(engine: TransformEngine): WebAdapter<C>;
  chunkOf(text: string): C;
  textOf(chunk: C): string;
  fromBytes(source: ReadableStream<Bytes>): ReadableStream<C>;
}

const byteWebAdapter: WebAdapterFamily<Bytes> = {
  adapter: "ReplaceContentTransformer",
  create: (engine) => new ReplaceContentTransformer(engine),
  chunkOf: utf8,
  textOf: (chunk) => new TextDecoder().decode(chunk),
  fromBytes: (source) => source
};

const textWebAdapter: WebAdapterFamily<string> = {
  adapter: "ReplaceContentTextTransformer",
  create: (engine) => new ReplaceContentTextTransformer(engine),
  chunkOf: (text) => text,
  textOf: (chunk) => chunk,
  fromBytes: (source) => source.pipeThrough(new TextDecoderStream())
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

export type { Bytes, WebAdapterFamily, WebChunk };

export {
  byteStreamOf,
  byteWebAdapter,
  everyTwoWayByteSplit,
  midCharacterSplits,
  textWebAdapter
};
