import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types";
import type { ReplacementContext } from "../../../replacement-processors/replacement-processor.base";
import createPartialMatchRegex from "regex-partial-match";

export class RegexCallbackSearchStrategy implements SyncCallbackProcessor {
  private partialChunk: string;
  private readonly replacement: (match: string, context: ReplacementContext) => string;
  private lastIndex: number | undefined;
  private readonly openRegex: RegExp;
  private readonly partialAtEndRegex: RegExp;
  private matchIndex: number = 0;
  private totalStreamOffset: number = 0;
  private currentChunkBaseOffset: number = 0;
  private replacementDelta: number = 0;

  constructor(
    replacement: (match: string, context: ReplacementContext) => string,
    needle: RegExp
  ) {
    this.replacement = replacement;
    this.openRegex = needle;
    this.partialAtEndRegex = createPartialMatchRegex(needle);
    this.partialChunk = "";
    this.lastIndex = undefined;
  }

  processChunk(chunk: string, enqueue: (output: string) => void): void {
    const bufferLength = this.partialChunk.length;
    this.currentChunkBaseOffset = this.totalStreamOffset - bufferLength;
    chunk = this.partialChunk + chunk;
    this.partialChunk = "";
    // lastIndex is the index of the first character after the last substitution.
    this.lastIndex = 0;
    this.replacementDelta = 0;
    const originalLength = chunk.length;
    chunk = chunk.replace(this.openRegex, this.replaceTag.bind(this));
    // Regular expression for an incomplete template at the end of a string.
    // Avoid looking at any characters that have already been substituted.
    this.partialAtEndRegex.lastIndex = this.lastIndex;
    this.lastIndex = undefined;
    const match = this.partialAtEndRegex.exec(chunk);
    if (match) {
      // cache the end and enqueue the front
      this.partialChunk = chunk.substring(match.index);
      chunk = chunk.substring(0, match.index);
    }
    enqueue(chunk);
    this.totalStreamOffset += originalLength - bufferLength;
  }

  flush(): string {
    return this.partialChunk;
  }

  private replaceTag(match: string, ...args: unknown[]): string {
    // offset is always the second-to-last argument in the replace callback:
    // (match, ...captures, offset, string) or (match, ...captures, offset, string, namedGroups)
    const numericOffset = args.at(-2) as number;
    const transformedOffset = numericOffset + this.replacementDelta;

    let replacement = this.replacement(match, {
      matchIndex: this.matchIndex++,
      streamIndices: [
        this.currentChunkBaseOffset + numericOffset,
        this.currentChunkBaseOffset + numericOffset + match.length
      ]
    });
    if (replacement === undefined) {
      replacement = "";
    }
    this.replacementDelta += replacement.length - match.length;
    this.lastIndex = transformedOffset + replacement.length;
    return replacement;
  }
}
