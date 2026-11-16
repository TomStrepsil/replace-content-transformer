import type { TransformEngine } from "../src/engines/types.ts";
import {
  ReplaceContentTextTransformer,
  ReplaceContentTransformer
} from "../src/adapters/web/index.ts";

type Bytes = ReturnType<TextEncoder["encode"]>;

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

const utf8Encoder = new TextEncoder();

const byteWebAdapter: WebAdapterFamily<Bytes> = {
  adapter: "ReplaceContentTransformer",
  create: (engine) => new ReplaceContentTransformer(engine),
  chunkOf: (text) => utf8Encoder.encode(text),
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
  const bytes = utf8Encoder.encode(text);
  return Array.from({ length: bytes.length + 1 }, (_, at) => [
    bytes.subarray(0, at),
    bytes.subarray(at)
  ]);
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
  textWebAdapter
};
