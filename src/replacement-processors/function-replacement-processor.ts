import {
  ReplacementProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";

/**
 * Configuration options for {@link FunctionReplacementProcessor}.
 * 
 * @typeParam T - The return type of the replacement function (string or Promise<string>)
 * @typeParam U - The search state type used by the search strategy
 */
export type FunctionReplacementProcessorOptions<T, U> =
  ReplacementProcessorOptions<U> & {
    /**
     * Function called for each match to generate the replacement content.
     * 
     * @param matchedContent - The matched text to be replaced
     * @param index - Zero-based index of this match (increments with each match)
     * @returns The replacement string, or a Promise<string> for async operations
     */
    replacement: (matchedContent: string, index: number) => T;
  };

/**
 * A replacement processor that uses a function to generate replacement values for each match.
 * 
 * This processor supports both synchronous and asynchronous (Promise-based) replacement functions:
 * - `FunctionReplacementProcessor<string>`: Synchronous replacements (default)
 * - `FunctionReplacementProcessor<Promise<string>>`: Async replacements with early discovery
 * 
 * The Promise variant is particularly powerful - it calls all replacement functions immediately
 * as matches are discovered, allowing parallel async operations. Promises are enqueued and
 * awaited by downstream consumers.
 * 
 * **IMPORTANT**: The Promise<string> pattern only works with WHATWG Streams (web adapters).
 * For Node.js streams, use {@link AsyncFunctionReplacementProcessor} instead.
 * 
 * @typeParam T - The return type of the replacement function (string or Promise<string>)
 * @typeParam U - The search state type used by the search strategy
 * 
 * @example Synchronous replacements
 * ```typescript
 * import { FunctionReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { ReplaceContentTransformer } from 'replace-content-transformer/web';
 * 
 * const processor = new FunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory(/{{(\w+)}}/g),
 *   replacement: (match, index) => `Replacement #${index}: ${match}`
 * });
 * 
 * const transformer = new ReplaceContentTransformer(processor);
 * ```
 * 
 * @example Async replacements with early discovery (WHATWG Streams only)
 * ```typescript
 * import { FunctionReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { ReplaceContentTransformer } from 'replace-content-transformer/web';
 * 
 * const processor = new FunctionReplacementProcessor<Promise<string>>({
 *   searchStrategy: searchStrategyFactory('{{id}}'),
 *   replacement: async (match, index) => {
 *     const data = await fetch(`/api/data/${index}`);
 *     return data.text();
 *   }
 * });
 * 
 * // All API calls start immediately as matches are found
 * const transformer = new ReplaceContentTransformer<Promise<string>>(processor);
 * ```
 */
export class FunctionReplacementProcessor<
  T extends string | Promise<string> = string,
  U = unknown
> extends ReplacementProcessorBase<U> {
  private readonly replacementFn: (matchedContent: string, index: number) => T;
  private matchIndex: number = 0;

  constructor({
    searchStrategy,
    replacement
  }: FunctionReplacementProcessorOptions<T, U>) {
    super({ searchStrategy });
    this.replacementFn = replacement;
  }

  *processChunk(input: string): Generator<T | string, void, undefined> {
    for (const { match, content } of this.searchStrategy.processChunk(
      input,
      this.searchState
    )) {
      if (!match) {
        yield content;
        continue;
      }
      yield this.replacementFn(content, this.matchIndex++);
    }
  }
}
