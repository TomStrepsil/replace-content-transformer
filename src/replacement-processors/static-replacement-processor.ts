import {
  ReplacementProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";
import { type SyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link StaticReplacementProcessor}.
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export type StaticReplacementProcessorOptions<
  TState,
  TMatch = string
> = ReplacementProcessorOptions<TState, TMatch> & {
  /** The static string that will replace all matched patterns */
  replacement: string;
};

/**
 * A replacement processor that replaces all matches with a static string value.
 * 
 * This is the simplest and most performant processor, suitable when all matches
 * should be replaced with the same constant value. It processes chunks synchronously
 * and is compatible with both WHATWG Streams and Node.js Transform streams.
 * 
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 * 
 * @example
 * ```typescript
 * import { StaticReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { ReplaceContentTransformer } from 'replace-content-transformer/web';
 * 
 * const processor = new StaticReplacementProcessor({
 *   searchStrategy: searchStrategyFactory('{{placeholder}}'),
 *   replacement: 'Hello, World!'
 * });
 * 
 * const transformer = new ReplaceContentTransformer(processor);
 * const stream = new TransformStream(transformer);
 * ```
 */
export class StaticReplacementProcessor<
  TState,
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> implements SyncProcessor {
  private readonly replacement: string;

  constructor({
    searchStrategy,
    replacement
  }: StaticReplacementProcessorOptions<TState, TMatch>) {
    super({ searchStrategy });
    this.replacement = replacement;
  }

  *processChunk(chunk: string): Generator<string, void, undefined> {
    for (const { isMatch, content } of this.searchStrategy.processChunk(
      chunk,
      this.searchState
    )) {
      yield isMatch ? this.replacement : content;
    }
  }
}
