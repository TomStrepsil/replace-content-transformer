import {
  ReplacementProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";
import { type SyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link IterableFunctionReplacementProcessor}.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export type IterableFunctionReplacementProcessorOptions<
  TState,
  TMatch = string
> = ReplacementProcessorOptions<TState, TMatch> & {
  /**
   * Function called for each match that returns an iterable of replacement strings.
   *
   * @param match - The matched content (type inferred from search strategy)
   * @param index - Zero-based index of this match
   * @param startIndex - start index of the match in the stream
   * @param endIndex - end index (exclusive) of the match in the stream
   * @returns An iterable of replacement strings
   */
  replacement: (match: TMatch, index: number, startIndex: number, endIndex: number) => Iterable<string>;
};

/**
 * A replacement processor that uses a function returning an iterable to generate replacement values.
 *
 * This processor is useful when each match should be replaced with multiple strings that can be
 * generated synchronously. The replacement function returns an iterable (array, generator, etc.)
 * and all values are yielded in sequence. Processing is synchronous and compatible with both
 * WHATWG Streams and Node.js Transform streams.
 *
 * Use this when you need to:
 * - Replace one match with multiple output strings
 * - Generate replacement content lazily using a generator function
 * - Expand matches into structured text output
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 *
 * @example Replace with multiple strings
 * ```typescript
 * import { IterableFunctionReplacementProcessor, searchStrategyFactory } from 'replace-content-transformer';
 * import { ReplaceContentTransformer } from 'replace-content-transformer/web';
 *
 * const processor = new IterableFunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory('{{list}}'),
 *   replacement: (match, index) => ['Item 1', 'Item 2', 'Item 3']
 * });
 *
 * const transformer = new ReplaceContentTransformer(processor);
 * ```
 *
 * @example Use a generator for lazy evaluation
 * ```typescript
 * const processor = new IterableFunctionReplacementProcessor({
 *   searchStrategy: searchStrategyFactory('{{repeat}}'),
 *   replacement: function* (match, index) {
 *     for (let i = 0; i < 5; i++) {
 *       yield `Iteration ${i}\n`;
 *     }
 *   }
 * });
 * ```
 */
export class IterableFunctionReplacementProcessor<
  TState,
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> implements SyncProcessor {
  private readonly replacementFn: (match: TMatch, index: number) => Iterable<string>;
  private matchIndex: number = 0;

  constructor({
    searchStrategy,
    replacement
  }: IterableFunctionReplacementProcessorOptions<TState, TMatch>) {
    super({ searchStrategy });
    this.replacementFn = replacement;
  }

  *processChunk(chunk: string): Generator<string, void, undefined> {
    for (const result of this.searchStrategy.processChunk(
      chunk,
      this.searchState
    )) {
      if (!result.isMatch) {
        yield result.content;
        continue;
      }
      yield* this.replacementFn(
        result.content,
        this.matchIndex++,
        result.startIndex,
        result.endIndex
      );
    }
  }
}
