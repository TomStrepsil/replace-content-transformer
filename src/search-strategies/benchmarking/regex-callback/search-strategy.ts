import type { SyncCallbackProcessor } from "../../../replacement-processors/benchmarking/types.ts";
import createPartialMatchRegex from "regex-partial-match";

export class RegexCallbackSearchStrategy implements SyncCallbackProcessor {
  private partialChunk: string;
  private readonly replacement: (match: string, index: number) => string;
  private lastIndex: number | undefined;
  private readonly openRegex: RegExp;
  private readonly partialAtEndRegex: RegExp;
  private matchIndex: number = 0;

  constructor(
    replacement: (match: string, index: number) => string,
    needle: RegExp
  ) {
    this.replacement = replacement;
    this.openRegex = needle;
    this.partialAtEndRegex = createPartialMatchRegex(needle);
    this.partialChunk = "";
    this.lastIndex = undefined;
  }

  processChunk(chunk: string, enqueue: (output: string) => void): void {
    chunk = this.partialChunk + chunk;
    this.partialChunk = "";
    // lastIndex is the index of the first character after the last substitution.
    this.lastIndex = 0;
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
  }

  flush(): string {
    return this.partialChunk;
  }

  private replaceTag(match: string, p1: string, offset: number): string {
    let replacement = this.replacement(match, this.matchIndex++);
    if (replacement === undefined) {
      replacement = "";
    }
    this.lastIndex = offset + replacement.length;
    return replacement;
  }
}
