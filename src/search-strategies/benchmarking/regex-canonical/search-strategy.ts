import type { Transformer } from "node:stream/web";

// based on https://streams.spec.whatwg.org/#example-ts-lipfuzz
export class RegexReplaceContentTransformer implements Transformer<string> {
  private partialChunk: string;
  private readonly replacement: (match: string, index: number) => string;
  private lastIndex: number | undefined;
  private readonly openRegex: RegExp;
  private readonly partialAtEndRegex: RegExp;
  private matchIndex: number = 0;

  constructor(
    replacement: (match: string, index: number) => string,
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
    controller.enqueue(chunk);
  }

  flush(controller: TransformStreamDefaultController<string>) {
    if (this.partialChunk.length > 0) {
      controller.enqueue(this.partialChunk);
    }
  }

  replaceTag(match: string, p1: string, offset: number) {
    let replacement = this.replacement(match, this.matchIndex++);
    if (replacement === undefined) {
      replacement = "";
    }
    this.lastIndex = offset + replacement.length;
    return replacement;
  }
}
