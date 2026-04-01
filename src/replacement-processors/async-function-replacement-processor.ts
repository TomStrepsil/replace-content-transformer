import {
  ReplacementProcessorBase,
  createProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";
import { type AsyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link createAsyncFunctionReplacementProcessor}.
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
   * @param match - The matched content
   * @param index - Zero-based index of this match
   * @returns Promise resolving to the replacement string
   */
  replacement: (match: TMatch, index: number) => Promise<string>;
};

/**
 * Creates a replacement processor that uses an async function to generate replacement values.
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
 * **Comparison with {@link createFunctionReplacementProcessor} with async replacement**:
 * - `createAsyncFunctionReplacementProcessor`: Awaits each replacement sequentially (serial execution)
 * - {@link createFunctionReplacementProcessor} with async: Calls all functions immediately (parallel execution)
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 *
 * @example Node.js async replacements
 * ```typescript
 * import { createAsyncFunctionReplacementProcessor, createSearchStrategy } from 'replace-content-transformer';
 * import { AsyncReplaceContentTransform } from 'replace-content-transformer/node';
 * import { Readable, pipeline } from 'stream';
 *
 * const processor = createAsyncFunctionReplacementProcessor({
 *   searchStrategy: createSearchStrategy('{{user}}'),
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
export function createAsyncFunctionReplacementProcessor<TState, TMatch = string>({
  searchStrategy,
  replacement
}: AsyncFunctionReplacementProcessorOptions<TState, TMatch>): AsyncProcessor {
  const { searchState, flush } = createProcessorBase(searchStrategy);
  let matchIndex = 0;

  return {
    async *processChunk(chunk: string): AsyncGenerator<string, void, undefined> {
      for (const { isMatch, content } of searchStrategy.processChunk(
        chunk,
        searchState
      )) {
        if (!isMatch) {
          yield content;
          continue;
        }
        yield await replacement(content, matchIndex++);
      }
    },
    flush
  };
}

/**
 * @deprecated Use {@link createAsyncFunctionReplacementProcessor} instead.
 */
export class AsyncFunctionReplacementProcessor<
  TState,
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> implements AsyncProcessor {
  #processor: AsyncProcessor;

  constructor(options: AsyncFunctionReplacementProcessorOptions<TState, TMatch>) {
    super(options);
    this.#processor = createAsyncFunctionReplacementProcessor(options);
  }

  async *processChunk(chunk: string): AsyncGenerator<string, void, undefined> {
    yield* this.#processor.processChunk(chunk);
  }

  flush(): string {
    return this.#processor.flush();
  }
}
