import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.ts";

export class BufferedIndexOfAnchoredCallbackSearchStrategy
  implements SyncCallbackProcessor
{
  private partialChunk: string;
  private readonly replacement: (match: string, index: number) => string;
  private readonly delimiters: string[];
  private matchIndex: number = 0;

  constructor(
    replacement: (match: string, index: number) => string,
    delimiters: string[]
  ) {
    this.replacement = replacement;
    this.delimiters = delimiters;
    this.partialChunk = "";
  }

  processChunk(chunk: string, enqueue: (output: string) => void): void {
    chunk = this.partialChunk + chunk;
    this.partialChunk = "";
    let position = 0;

    while (position < chunk.length) {
      const startIndex = chunk.indexOf(this.delimiters[0], position);

      if (startIndex === -1) {
        const bufferSize = this.delimiters[0].length - 1;
        const splitPoint = Math.max(position, chunk.length - bufferSize);
        this.partialChunk = chunk.slice(splitPoint);
        if (position !== splitPoint) {
          enqueue(chunk.slice(position, splitPoint));
        }
        return;
      }

      if (startIndex > position) {
        enqueue(chunk.substring(position, startIndex));
      }

      let currentPos = startIndex + this.delimiters[0].length;
      let delimiterIndex = 1;

      while (delimiterIndex < this.delimiters.length) {
        const delimiter = this.delimiters[delimiterIndex];
        const delimIndex = chunk.indexOf(delimiter, currentPos);

        if (delimIndex === -1) {
          this.partialChunk = chunk.substring(startIndex);
          return;
        }

        currentPos = delimIndex + delimiter.length;
        delimiterIndex++;
      }

      const matchEnd = currentPos;
      const match = chunk.substring(startIndex, matchEnd);
      const replacement = this.replacement(match, this.matchIndex++);
      enqueue(replacement);
      position = matchEnd;
    }
  }

  flush(): string {
    return this.partialChunk;
  }
}
