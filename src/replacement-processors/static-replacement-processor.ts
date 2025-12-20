import {
  ReplacementProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";
import { type SyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link StaticReplacementProcessor}.
 * 
 * @typeParam T - The search state type used by the search strategy
 */
export type StaticReplacementProcessorOptions<T> =
  ReplacementProcessorOptions<T> & {
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
 * @typeParam T - The search state type used by the search strategy
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
export class StaticReplacementProcessor<T>
  extends ReplacementProcessorBase<T>
  implements SyncProcessor
{
  private readonly replacement: string;

  constructor({
    searchStrategy,
    replacement
  }: StaticReplacementProcessorOptions<T>) {
    super({ searchStrategy });
    this.replacement = replacement;
  }

  *processChunk(chunk: string): Generator<string, void, undefined> {
    for (const { match, content } of this.searchStrategy.processChunk(
      chunk,
      this.searchState
    )) {
      yield match ? this.replacement : content;
    }
  }
}
