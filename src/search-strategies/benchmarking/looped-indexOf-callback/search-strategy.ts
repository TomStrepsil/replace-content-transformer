import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types";
import type { ReplacementContext } from "../../../replacement-processors/replacement-processor.base";

export class LoopedIndexOfCallbackSearchStrategy
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
    this.startToken = tokens[0];
    this.endToken = tokens[1];
    this.partialChunk = "";
    this.lastIndex = undefined;
  }

  private attemptPartialMatchAtEnd(
    chunk: string,
    fromIndex: number,
    enqueue: (output: string) => void
  ): void {
    const remainder = chunk.slice(fromIndex);
    for (
      let partialLength = this.startToken.length - 1;
      partialLength >= 1;
      partialLength--
    ) {
      const chunkSuffix = remainder.slice(-partialLength);
      const tokenPrefix = this.startToken.slice(0, partialLength);
      if (chunkSuffix === tokenPrefix) {
        const beforePartial = remainder.slice(0, -partialLength);
        if (beforePartial) {
          enqueue(beforePartial);
        }
        this.partialChunk = chunkSuffix;
        return;
      }
    }
    if (remainder) {
      enqueue(remainder);
    }
  }

  processChunk(chunk: string, enqueue: (output: string) => void): void {
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
          this.attemptPartialMatchAtEnd(chunk, this.lastIndex, enqueue);
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
      this.totalStreamOffset += chunkLength - bufferLength;
    }
  }

  flush(): string {
    return this.partialChunk;
  }
}
