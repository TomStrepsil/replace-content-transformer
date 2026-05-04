import {
  ReplacementProcessorBase,
  type ReplacementContext,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.js";

/**
 * Configuration options for {@link FunctionReplacementProcessor}.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export type FunctionReplacementProcessorOptions<
  TState,
  TMatch = string
> = ReplacementProcessorOptions<TState, TMatch> & {
  /**
   * Function called for each match to generate the replacement content.
   * 
   * @param context - The match context
   * @returns The replacement string, or a Promise<string> for async operations
   */
  replacement: (match: TMatch, context: ReplacementContext) => string;
};

/**
 * A replacement processor that uses a **synchronous** function to
 * generate replacement values for each match.
 *
 * For async replacements, see:
 * - {@link AsyncFunctionReplacementProcessor} — serial, awaits each
 *   replacement before looking for the next match.
 * - {@link LookaheadAsyncIterableTransformer} — pipelined: discovers
 *   later matches while earlier replacements are in flight, with
 *   pluggable concurrency control and in-order output.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 *
 * @example Synchronous replacements
 * ```typescript
 * import { FunctionReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { ReplaceContentTransformer } from 'replace-content-transformer/web';
 *
 * const processor = new FunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory(/{{(\w+)}}/g),
 *   replacement: (match, { matchIndex }) => `Replacement #${matchIndex}: ${match[1]}`
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
 *   replacement: async (match, { matchIndex }) => {
 *     const data = await fetch(`/api/data/${matchIndex}`);
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
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> {
  private readonly replacementFn: (match: TMatch, context: ReplacementContext) => string;
  private matchIndex: number = 0;

  constructor({
    searchStrategy,
    replacement
  }: FunctionReplacementProcessorOptions<TState, TMatch>) {
    super({ searchStrategy });
    this.replacementFn = replacement;
  }

  *processChunk(input: string): Generator<string, void, undefined> {
    for (const result of this.searchStrategy.processChunk(
      input,
      this.searchState
    )) {
      if (!result.isMatch) {
        yield result.content;
        continue;
      }
      yield this.replacementFn(result.content, {
        matchIndex: this.matchIndex++,
        streamIndices: result.streamIndices
      });
    }
  }
}
