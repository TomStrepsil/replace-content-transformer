import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.ts";

export class BufferedIndexOfCallbackSearchStrategy
  implements SyncCallbackProcessor
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
    this.partialChunk = "";
    this.startToken = tokens[0];
    this.endToken = tokens[1];
    this.lastIndex = undefined;
  }

  processChunk(chunk: string, enqueue: (output: string) => void): void {
    chunk = this.partialChunk + chunk;
    this.partialChunk = "";
    this.lastIndex = 0;

    while (this.lastIndex < chunk.length) {
      let index = chunk.indexOf(this.startToken, this.lastIndex);
      if (index === -1) {
        const bufferSize = this.startToken.length - 1;
        const splitPoint = Math.max(this.lastIndex, chunk.length - bufferSize);
        this.partialChunk = chunk.slice(splitPoint);
        const content = chunk.slice(this.lastIndex, splitPoint);
        if (content) {
          enqueue(content);
        }
        return;
      }

      if (index > this.lastIndex) {
        enqueue(chunk.substring(this.lastIndex, index));
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
        enqueue(replacement);
      } else {
        this.partialChunk = chunk.substring(index);
        return;
      }
    }
  }

  flush(): string {
    return this.partialChunk;
  }
}
