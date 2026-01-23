import {
  ReplacementProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";

/**
 * Configuration options for {@link FunctionReplacementProcessor}.
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 * @typeParam R - The return type of the replacement function (string or Promise<string>)
 */
export type FunctionReplacementProcessorOptions<
  TState,
  TMatch = string,
  R extends string | Promise<string> = string
> = ReplacementProcessorOptions<TState, TMatch> & {
  /**
   * Function called for each match to generate the replacement content.
   * 
   * @param match - The matched content (type inferred from search strategy)
   * @param index - Zero-based index of this match (increments with each match)
   * @returns The replacement string, or a Promise<string> for async operations
   */
  replacement: (match: TMatch, index: number) => R;
};

/**
 * A replacement processor that uses a function to generate replacement values for each match.
 * 
 * This processor supports both synchronous and asynchronous (Promise-based) replacement functions:
 * - Synchronous: `replacement: (match) => string`
 * - Async with early discovery: `replacement: async (match) => string`
 * 
 * The Promise variant is particularly powerful - it calls all replacement functions immediately
 * as matches are discovered, allowing parallel async operations. Promises are enqueued and
 * awaited by downstream consumers.
 * 
 * **IMPORTANT**: The Promise<string> pattern only works with WHATWG Streams (web adapters).
 * For Node.js streams, use {@link AsyncFunctionReplacementProcessor} instead.
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 * @typeParam R - The return type of the replacement function (string or Promise<string>)
 * 
 * @example Synchronous replacements
 * ```typescript
 * import { FunctionReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { ReplaceContentTransformer } from 'replace-content-transformer/web';
 * 
 * const processor = new FunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory(/{{(\w+)}}/g),
 *   replacement: (match, index) => `Replacement #${index}: ${match[1]}`
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
 * const processor = new FunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory('{{id}}'),
 *   replacement: async (match, index) => {
 *     const data = await fetch(`/api/data/${index}`);
 *     return data.text();
 *   }
 * });
 * 
 * // All API calls start immediately as matches are found
 * const transformer = new ReplaceContentTransformer(processor);
 * ```
 */
export class FunctionReplacementProcessor<
  TState,
  TMatch = string,
  R extends string | Promise<string> = string
> extends ReplacementProcessorBase<TState, TMatch> {
  private readonly replacementFn: (match: TMatch, index: number) => R;
  private matchIndex: number = 0;

  constructor({
    searchStrategy,
    replacement
  }: FunctionReplacementProcessorOptions<TState, TMatch, R>) {
    super({ searchStrategy });
    this.replacementFn = replacement;
  }

  *processChunk(input: string): Generator<R | string, void, undefined> {
    for (const result of this.searchStrategy.processChunk(
      input,
      this.searchState
    )) {
      if (!result.isMatch) {
        yield result.content;
        continue;
      }
      yield this.replacementFn(result.content, this.matchIndex++);
    }
  }
}
