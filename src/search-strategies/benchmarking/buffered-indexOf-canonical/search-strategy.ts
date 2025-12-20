import type { Transformer } from "node:stream/web";

// based on https://streams.spec.whatwg.org/#example-ts-lipfuzz
export class BufferedIndexOfReplaceContentTransformer
  implements Transformer<string>
{
  private partialChunk: string;
  private readonly replacement: (match: string, index: number) => string;
  private lastIndex: number | undefined;
  private readonly startToken: string;
  private readonly endToken: string;
  private matchIndex: number = 0;

  constructor(
    replacement: (match: string, index: number) => string,
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
    chunk = this.partialChunk + chunk;
    this.partialChunk = "";
    this.lastIndex = 0;
    while (this.lastIndex < chunk.length) {
      let index = chunk.indexOf(this.startToken, this.lastIndex);
      if (index === -1) {
        const splitPoint = Math.max(
          this.lastIndex,
          chunk.length - this.startToken.length - 1
        );
        this.partialChunk = chunk.slice(splitPoint);
        const content = chunk.slice(this.lastIndex, splitPoint);
        if (content) {
          controller.enqueue(content);
        }
        return;
      }

      if (index > 0) {
        controller.enqueue(chunk.substring(this.lastIndex, index));
      }

      const endIndex = chunk.indexOf(
        this.endToken,
        index + this.startToken.length
      );
      if (endIndex !== -1) {
        this.lastIndex = endIndex + this.endToken.length;
        let replacement = this.replacement(
          chunk.substring(index, this.lastIndex),
          this.matchIndex++
        );
        controller.enqueue(replacement);
      } else {
        this.partialChunk = chunk.substring(index);
        return;
      }
    }
  }

  flush(controller: TransformStreamDefaultController<string>) {
    if (this.partialChunk.length > 0) {
      controller.enqueue(this.partialChunk);
    }
  }
}
