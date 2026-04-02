import { ReplaceContentTransformBase } from "./transform-base.js";
import type { SyncProcessor } from "../../replacement-processors/types.js";

/**
 * A synchronous Transform stream for Node.js that replaces content in streaming text.
 * 
 * This adapter integrates replacement processors with Node.js native streams,
 * providing a Transform stream that can be used with `.pipe()` or `.pipeline()`.
 * 
 * @example
 * ```typescript
 * import { ReplaceContentTransform } from "replace-content-transformer/node";
 * import { StaticReplacementProcessor } from "replace-content-transformer";
 * 
 * const transform = new ReplaceContentTransform(
 *   new StaticReplacementProcessor({ searchStrategy, replacement: "NEW" })
 * );
 * 
 * readableStream.pipe(transform).pipe(writableStream);
 * ```
 */
export class ReplaceContentTransform extends ReplaceContentTransformBase {
  protected processor: SyncProcessor;

  constructor(processor: SyncProcessor) {
    super({
      transform: (chunk, _, callback) => {
        for (const output of this.processor.processChunk(chunk.toString())) {
          this.push(output);
        }
        callback();
      },
      flush: (callback) => this.flush(callback)
    });
    this.processor = processor;
  }
}
