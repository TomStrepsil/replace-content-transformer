import {
  ReplacementProcessorBase,
  type ReplacementContext,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.js";
import { type AsyncProcessor } from "./types.js";

/**
 * Configuration options for {@link AsyncFunctionReplacementProcessor}.
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export type AsyncFunctionReplacementProcessorOptions<
  TState,
  TMatch = string
> = ReplacementProcessorOptions<TState, TMatch> & {
  /**
   * Async function called for each match to generate the replacement content.
   * 
   * @param context - The match context
   * @returns Promise resolving to the replacement string
   */
  replacement: (match: TMatch, context: ReplacementContext) => Promise<string>;
};

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
 * **Comparison with FunctionReplacementProcessor with async replacement**:
 * - `AsyncFunctionReplacementProcessor`: Awaits each replacement sequentially (serial execution)
 * - `FunctionReplacementProcessor` with async: Calls all functions immediately (parallel execution)
 * 
 * The sequential behavior ensures matches are replaced in order and works with Node.js streams,
 * but may be slower than the parallel Promise pattern available in WHATWG Streams.
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 * 
 * @example Node.js async replacements
 * ```typescript
 * import { AsyncFunctionReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { AsyncReplaceContentTransform } from 'replace-content-transformer/node';
 * import { Readable, pipeline } from 'stream';
 * 
 * const processor = new AsyncFunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory('{{user}}'),
 *   replacement: async (match, { matchIndex }) => {
 *     const response = await fetch(`/api/users/${matchIndex}`);
 *     return response.text();
 *   }
 * });
 * 
 * const transform = new AsyncReplaceContentTransform(processor);
 * pipeline(Readable.from(['User: {{user}}']), transform, process.stdout);
 * ```
 */
export class AsyncFunctionReplacementProcessor<
  TState,
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> implements AsyncProcessor {
  private readonly replacementFn: (match: TMatch, context: ReplacementContext) => Promise<string>;
  private matchIndex: number = 0;

  constructor({
    searchStrategy,
    replacement
  }: AsyncFunctionReplacementProcessorOptions<TState, TMatch>) {
    super({ searchStrategy });
    this.replacementFn = replacement;
  }

  async *processChunk(chunk: string): AsyncGenerator<string, void, undefined> {
    for (const result of this.searchStrategy.processChunk(
      chunk,
      this.searchState
    )) {
      if (!result.isMatch) {
        yield result.content;
        continue;
      }
      yield await this.replacementFn(result.content, {
        matchIndex: this.matchIndex++,
        streamIndices: result.streamIndices
      });
    }
  }
}
