import { ReplaceContentTransformBase } from "./transform-base.js";
import type { AsyncProcessor } from "../../replacement-processors/types.js";

/**
 * An asynchronous Transform stream for Node.js that replaces content in streaming text.
 * 
 * This adapter integrates async replacement processors with Node.js native streams,
 * providing a Transform stream that handles asynchronous replacements and can be used
 * with `.pipe()` or `.pipeline()`.
 * 
 * Use this when you need to perform async operations (like API calls or database lookups)
 * during replacement. For synchronous replacements, use `ReplaceContentTransform` instead.
 * 
 * @example
 * ```typescript
 * import { AsyncReplaceContentTransform } from "replace-content-transformer/node";
 * import { AsyncFunctionReplacementProcessor } from "replace-content-transformer";
 * 
 * const transform = new AsyncReplaceContentTransform(
 *   new AsyncFunctionReplacementProcessor({
 *     searchStrategy,
 *     replacement: async (match) => {
 *       const response = await fetch(`/api/${match}`);
 *       return response.text();
 *     }
 *   })
 * );
 * 
 * readableStream.pipe(transform).pipe(writableStream);
 * ```
 */
export class AsyncReplaceContentTransform extends ReplaceContentTransformBase {
  protected processor: AsyncProcessor;

  constructor(processor: AsyncProcessor) {
    super({
      transform: async (chunk, _, callback) => {
        for await (const output of this.processor.processChunk(
          chunk.toString()
        )) {
          this.push(output);
        }
        callback();
      },
      flush: (callback) => this.flush(callback)
    });
    this.processor = processor;
  }
}
