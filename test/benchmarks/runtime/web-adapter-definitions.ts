import { SerialTransformEngine } from "../../../src/engines/index.ts";
import { StringAnchorSearchStrategy } from "../../../src/search-strategies/index.ts";
import {
  ReplaceContentTextTransformer,
  ReplaceContentTransformer
} from "../../../src/adapters/web/index.ts";

type Bytes = ReturnType<TextEncoder["encode"]>;

export interface WebAdapterPipeline {
  name: string;
  source: "bytes" | "strings";
  pipe(source: ReadableStream<Bytes | string>): ReadableStream<Bytes | string>;
}

const searchStrategy = new StringAnchorSearchStrategy(["{{", "}}"]);
const engine = () =>
  new SerialTransformEngine({ searchStrategy, replacement: "Ada" });

const document = Array.from(
  { length: 2000 },
  (_, i) => `<p>Paragraph ${i} for {{name}}, with some filler text — and «quotes».</p>\n`
).join("");
const expected = document.replaceAll("{{name}}", "Ada");
const encodedDocument = new TextEncoder().encode(document);

export const webAdapterChunkSizes = [16 * 1024, 1024, 64];

export const webAdapterPipelines: WebAdapterPipeline[] = [
  {
    name: "bytes → ReplaceContentTransformer",
    source: "bytes",
    pipe: (source) =>
      (source as ReadableStream<Bytes>).pipeThrough(
        new TransformStream(new ReplaceContentTransformer(engine()))
      )
  },
  {
    name: "bytes → TextDecoderStream → ReplaceContentTextTransformer → TextEncoderStream",
    source: "bytes",
    pipe: (source) =>
      (source as ReadableStream<Bytes>)
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine())))
        .pipeThrough(new TextEncoderStream())
  },
  {
    name: "strings → ReplaceContentTextTransformer",
    source: "strings",
    pipe: (source) =>
      (source as ReadableStream<string>).pipeThrough(
        new TransformStream(new ReplaceContentTextTransformer(engine()))
      )
  },
  {
    name: "strings → TextEncoderStream → ReplaceContentTransformer → TextDecoderStream",
    source: "strings",
    pipe: (source) =>
      (source as ReadableStream<string>)
        .pipeThrough(new TextEncoderStream())
        .pipeThrough(new TransformStream(new ReplaceContentTransformer(engine())))
        .pipeThrough(new TextDecoderStream())
  }
];

export function webAdapterInput(
  source: WebAdapterPipeline["source"],
  chunkSize: number
): (Bytes | string)[] {
  const whole = source === "bytes" ? encodedDocument : document;
  const chunks: (Bytes | string)[] = [];
  for (let at = 0; at < whole.length; at += chunkSize) {
    chunks.push(
      typeof whole === "string"
        ? whole.slice(at, at + chunkSize)
        : whole.subarray(at, at + chunkSize)
    );
  }
  return chunks;
}

function streamOf(chunks: (Bytes | string)[]): ReadableStream<Bytes | string> {
  let next = 0;
  return new ReadableStream({
    pull(controller) {
      if (next < chunks.length) controller.enqueue(chunks[next++]);
      else controller.close();
    }
  });
}

export async function runWebAdapterPipeline(
  pipeline: WebAdapterPipeline,
  chunks: (Bytes | string)[]
): Promise<number> {
  let outputChunks = 0;
  const reader = pipeline.pipe(streamOf(chunks)).getReader();
  while (!(await reader.read()).done) outputChunks++;
  return outputChunks;
}

export async function validateWebAdapterPipeline(
  pipeline: WebAdapterPipeline,
  chunks: (Bytes | string)[]
): Promise<void> {
  const decoder = new TextDecoder();
  let output = "";
  for await (const chunk of pipeline.pipe(streamOf(chunks))) {
    output +=
      typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  output += decoder.decode();
  if (output !== expected) {
    throw new Error(`Benchmark validation failed - ${pipeline.name} changed the output`);
  }
}
