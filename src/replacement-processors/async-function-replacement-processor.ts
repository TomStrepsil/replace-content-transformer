import { ReplacementProcessorBase } from "./replacement-processor.base.ts";
import { type FunctionReplacementProcessorOptions } from "./function-replacement-processor.ts";
import { type AsyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link AsyncFunctionReplacementProcessor}.
 * 
 * @typeParam T - The search state type used by the search strategy
 */
type AsyncFunctionReplacementProcessorOptions<T> =
  FunctionReplacementProcessorOptions<Promise<string>, T>;

/**
 * A replacement processor that uses an async function to generate replacement values.
 * 
 * This processor is designed for Node.js Transform streams where replacement functions
 * need to perform async operations (API calls, database queries, file I/O, etc.).
 * Each replacement function is awaited sequentially before processing the next match.
 * 
 * **When to use**:
 * - With Node.js streams (required for async operations on Node)
 * - When replacements must be processed in strict sequential order
 * - For simpler async patterns without needing early discovery
 * 
 * **Comparison with FunctionReplacementProcessor<Promise<string>>**:
 * - `AsyncFunctionReplacementProcessor`: Awaits each replacement sequentially (serial execution)
 * - `FunctionReplacementProcessor<Promise<string>>`: Calls all functions immediately (parallel execution)
 * 
 * The sequential behavior ensures matches are replaced in order and works with Node.js streams,
 * but may be slower than the parallel Promise pattern available in WHATWG Streams.
 * 
 * @typeParam T - The search state type used by the search strategy
 * 
 * @example Node.js async replacements
 * ```typescript
 * import { AsyncFunctionReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { AsyncReplaceContentTransform } from 'replace-content-transformer/node';
 * import { Readable, pipeline } from 'stream';
 * 
 * const processor = new AsyncFunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory('{{user}}'),
 *   replacement: async (match, index) => {
 *     const response = await fetch(`/api/users/${index}`);
 *     return response.text();
 *   }
 * });
 * 
 * const transform = new AsyncReplaceContentTransform(processor);
 * pipeline(Readable.from(['User: {{user}}']), transform, process.stdout);
 * ```
 */
export class AsyncFunctionReplacementProcessor<T>
  extends ReplacementProcessorBase<T>
  implements AsyncProcessor
{
  private readonly replacementFn: AsyncFunctionReplacementProcessorOptions<T>["replacement"];
  private matchIndex: number = 0;

  constructor({
    searchStrategy,
    replacement
  }: AsyncFunctionReplacementProcessorOptions<T>) {
    super({ searchStrategy });
    this.replacementFn = replacement;
  }

  async *processChunk(chunk: string): AsyncGenerator<string, void, undefined> {
    for (const { match, content } of this.searchStrategy.processChunk(
      chunk,
      this.searchState
    )) {
      if (!match) {
        yield content;
        continue;
      }
      yield await this.replacementFn(content, this.matchIndex++);
    }
  }
}
