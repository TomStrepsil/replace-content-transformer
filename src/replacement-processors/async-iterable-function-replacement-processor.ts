import {
  ReplacementProcessorBase,
  type ReplacementContext,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";
import { type AsyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link AsyncIterableFunctionReplacementProcessor}.
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
   * @param context - The match context
   * @returns Promise resolving to an async iterable of replacement strings
   */
  replacement: (match: TMatch, context: ReplacementContext) => Promise<AsyncIterable<string>>;
};

/**
 * A replacement processor that uses an async function returning an async iterable.
 * 
 * This processor combines async operations with multiple-value replacements. The replacement
 * function returns a Promise of an AsyncIterable (like an async generator), allowing each match
 * to be replaced with multiple strings that are generated asynchronously. Each replacement is
 * processed sequentially, and all values from each iterable are consumed before continuing.
 * 
 * **Use cases**:
 * - Streaming large replacement content from async sources (databases, APIs, files)
 * - Replacing matches with paginated or chunked data
 * - Lazy generation of replacement content with async dependencies
 * - Node.js streams requiring multi-value async replacements
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 * 
 * @example Streaming replacement from async source
 * ```typescript
 * import { AsyncIterableFunctionReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { AsyncReplaceContentTransform } from 'replace-content-transformer/node';
 * import { pipeline, Readable } from 'stream';
 * 
 * const processor = new AsyncIterableFunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory('{{stream}}'),
 *   replacement: async function* (match, { matchIndex }) {
 *     const response = await fetch(`/api/stream/${matchIndex}`);
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
 * const processor = new AsyncIterableFunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory('{{users}}'),
 *   replacement: async function* () {
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
export class AsyncIterableFunctionReplacementProcessor<
  TState,
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> implements AsyncProcessor {
  private readonly replacementFn: (match: TMatch, context: ReplacementContext) => Promise<AsyncIterable<string>>;
  private matchIndex: number = 0;

  constructor({
    searchStrategy,
    replacement
  }: AsyncIterableFunctionReplacementProcessorOptions<TState, TMatch>) {
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
      yield* await this.replacementFn(result.content, {
        matchIndex: this.matchIndex++,
        streamIndices: result.streamIndices
      });
    }
  }
}
