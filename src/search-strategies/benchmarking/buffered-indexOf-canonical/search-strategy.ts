import type { Transformer } from "node:stream/web";
import type { ReplacementContext } from "../../../replacement-processors/replacement-processor.base.ts";

// based on https://streams.spec.whatwg.org/#example-ts-lipfuzz
export class BufferedIndexOfReplaceContentTransformer
  implements Transformer<string>
{
  private partialChunk: string;
  private readonly replacement: (match: string, context: ReplacementContext) => string;
  private lastIndex: number | undefined;
  private readonly startToken: string;
  private readonly endToken: string;
  private matchIndex: number = 0;
  private totalStreamOffset: number = 0;

  constructor(
    replacement: (match: string, context: ReplacementContext) => string,
    tokens: string[]
  ) {
    this.replacement = replacement;
    this.startToken = tokens[0];
    this.endToken = tokens[1];
    this.partialChunk = "";
    this.lastIndex = undefined;
  }

  transform(
    chunk: string,
    controller: TransformStreamDefaultController<string>
  ) {
    const bufferLength = this.partialChunk.length;
    const baseOffset = this.totalStreamOffset - bufferLength;
    chunk = this.partialChunk + chunk;
    this.partialChunk = "";
    this.lastIndex = 0;
    const chunkLength = chunk.length;
    
    try {
      while (this.lastIndex < chunkLength) {
        let index = chunk.indexOf(this.startToken, this.lastIndex);
        if (index === -1) {
          const splitPoint = Math.max(
            this.lastIndex,
            chunkLength - this.startToken.length - 1
          );
          this.partialChunk = chunk.slice(splitPoint);
          const content = chunk.slice(this.lastIndex, splitPoint);
          if (content) {
            controller.enqueue(content);
          }
          return;
        }

        if (index > this.lastIndex!) {
          controller.enqueue(chunk.substring(this.lastIndex, index));
        }

        const endIndex = chunk.indexOf(
          this.endToken,
          index + this.startToken.length
        );
        if (endIndex !== -1) {
          this.lastIndex = endIndex + this.endToken.length;
          const match = chunk.substring(index, this.lastIndex);
          let replacement = this.replacement(match, {
            matchIndex: this.matchIndex++,
            streamIndices: [baseOffset + index, baseOffset + this.lastIndex]
          });
          controller.enqueue(replacement);
        } else {
          this.partialChunk = chunk.substring(index);
          return;
        }
      }
    } finally {
      this.totalStreamOffset += chunkLength - bufferLength;
    }
  }

  flush(controller: TransformStreamDefaultController<string>) {
    if (this.partialChunk.length > 0) {
      controller.enqueue(this.partialChunk);
    }
  }
}
