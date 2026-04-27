import type { Transformer } from "node:stream/web";
import type { ReplacementContext } from "../../../replacement-processors/replacement-processor.base.ts";

// based on https://streams.spec.whatwg.org/#example-ts-lipfuzz
export class RegexReplaceContentTransformer implements Transformer<string> {
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
    openRegex: RegExp,
    partialAtEndRegex: RegExp
  ) {
    this.replacement = replacement;
    this.openRegex = openRegex;
    this.partialAtEndRegex = partialAtEndRegex;
    this.partialChunk = "";
    this.lastIndex = undefined;
  }

  transform(
    chunk: string,
    controller: TransformStreamDefaultController<string>
  ) {
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
    controller.enqueue(chunk);
    this.totalStreamOffset += originalLength - bufferLength;
  }

  flush(controller: TransformStreamDefaultController<string>) {
    if (this.partialChunk.length > 0) {
      controller.enqueue(this.partialChunk);
    }
  }

  replaceTag(match: string, p1: string, offset: number) {
    // String.replace callback argument shape depends on capture groups.
    // Resolve the numeric offset robustly for regexes with or without captures.
    const offsetValue =
      typeof p1 === "number"
        ? p1
        : typeof offset === "number"
          ? offset
          : 0;
    const transformedOffset = offsetValue + this.replacementDelta;

    let replacement = this.replacement(match, {
      matchIndex: this.matchIndex++,
      streamIndices: [
        this.currentChunkBaseOffset + offsetValue,
        this.currentChunkBaseOffset + offsetValue + match.length
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
