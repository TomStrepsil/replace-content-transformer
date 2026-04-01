import {
  ReplacementProcessorBase,
  createProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";
import { type AsyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link createAsyncIterableFunctionReplacementProcessor}.
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export type AsyncIterableFunctionReplacementProcessorOptions<
  TState,
  TMatch = string
> = ReplacementProcessorOptions<TState, TMatch> & {
  /**
   * Async function called for each match that returns an async iterable of replacement strings.
   * 
   * @param match - The matched content (type inferred from search strategy)
   * @param index - Zero-based index of this match
   * @returns Promise resolving to an async iterable of replacement strings
   */
  replacement: (match: TMatch, index: number) => Promise<AsyncIterable<string>>;
};

/**
 * Creates a replacement processor that uses an async function returning an async iterable.
 * 
 * This processor combines async operations with multiple-value replacements. The replacement
 * function returns a Promise of an AsyncIterable (like an async generator), allowing each match
 * to be replaced with multiple strings that are generated asynchronously. Each replacement is
 * processed sequentially, and all values from each iterable are consumed before continuing.
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 *
 * @example Streaming replacement from async source
 * ```typescript
 * import { createAsyncIterableFunctionReplacementProcessor, createSearchStrategy } from 'replace-content-transformer';
 * import { AsyncReplaceContentTransform } from 'replace-content-transformer/node';
 * import { pipeline, Readable } from 'stream';
 *
 * const processor = createAsyncIterableFunctionReplacementProcessor({
 *   searchStrategy: createSearchStrategy('{{stream}}'),
 *   replacement: async function* (match, index) {
 *     const response = await fetch(`/api/stream/${index}`);
 *     const reader = response.body.getReader();
 *
 *     while (true) {
 *       const { done, value } = await reader.read();
 *       if (done) break;
 *       yield new TextDecoder().decode(value);
 *     }
 *   }
 * });
 *
 * const transform = new AsyncReplaceContentTransform(processor);
 * pipeline(Readable.from(['Data: {{stream}}']), transform, process.stdout);
 * ```
 *
 * @example Paginated data replacement
 * ```typescript
 * const processor = createAsyncIterableFunctionReplacementProcessor({
 *   searchStrategy: createSearchStrategy('{{users}}'),
 *   replacement: async function* (match, index) {
 *     let page = 0;
 *     let hasMore = true;
 *
 *     while (hasMore) {
 *       const response = await fetch(`/api/users?page=${page++}`);
 *       const data = await response.json();
 *
 *       for (const user of data.users) {
 *         yield `${user.name}\n`;
 *       }
 *
 *       hasMore = data.hasMore;
 *     }
 *   }
 * });
 * ```
 */
export function createAsyncIterableFunctionReplacementProcessor<TState, TMatch = string>({
  searchStrategy,
  replacement
}: AsyncIterableFunctionReplacementProcessorOptions<TState, TMatch>): AsyncProcessor {
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
        yield* await replacement(content, matchIndex++);
      }
    },
    flush
  };
}

/**
 * @deprecated Use {@link createAsyncIterableFunctionReplacementProcessor} instead.
 */
export class AsyncIterableFunctionReplacementProcessor<
  TState,
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> implements AsyncProcessor {
  #processor: AsyncProcessor;

  constructor(options: AsyncIterableFunctionReplacementProcessorOptions<TState, TMatch>) {
    super(options);
    this.#processor = createAsyncIterableFunctionReplacementProcessor(options);
  }

  async *processChunk(chunk: string): AsyncGenerator<string, void, undefined> {
    yield* this.#processor.processChunk(chunk);
  }

  flush(): string {
    return this.#processor.flush();
  }
}
