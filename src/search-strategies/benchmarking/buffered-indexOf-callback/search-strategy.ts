import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.js";
import type { ReplacementContext } from "../../../replacement-processors/replacement-processor.base.js";

export class BufferedIndexOfCallbackSearchStrategy
  implements SyncCallbackProcessor
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
    this.partialChunk = "";
    this.startToken = tokens[0];
    this.endToken = tokens[1];
    this.lastIndex = undefined;
  }

  processChunk(chunk: string, enqueue: (output: string) => void): void {
    const bufferLength = this.partialChunk.length;
    const baseOffset = this.totalStreamOffset - bufferLength;
    chunk = this.partialChunk + chunk;
    this.partialChunk = "";
    this.lastIndex = 0;

    try {
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
          const match = chunk.substring(index, this.lastIndex);
          let replacement = this.replacement(match, {
            matchIndex: this.matchIndex++,
            streamIndices: [baseOffset + index, baseOffset + this.lastIndex]
          });
          enqueue(replacement);
        } else {
          this.partialChunk = chunk.substring(index);
          return;
        }
      }
    } finally {
      this.totalStreamOffset += chunk.length - bufferLength;
    }
  }

  flush(): string {
    return this.partialChunk;
  }
}
