import { ReplacementProcessorBase } from "./replacement-processor.base.ts";
import { type FunctionReplacementProcessorOptions } from "./function-replacement-processor.ts";
import { type SyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link IterableFunctionReplacementProcessor}.
 *
 * @typeParam T - The search state type used by the search strategy
 */
type IterableFunctionReplacementProcessorOptions<T> =
  FunctionReplacementProcessorOptions<Iterable<string>, T>;

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
 * @typeParam T - The search state type used by the search strategy
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
export class IterableFunctionReplacementProcessor<T>
  extends ReplacementProcessorBase<T>
  implements SyncProcessor
{
  private readonly replacementFn: IterableFunctionReplacementProcessorOptions<T>["replacement"];
  private matchIndex: number = 0;

  constructor({
    searchStrategy,
    replacement
  }: IterableFunctionReplacementProcessorOptions<T>) {
    super({ searchStrategy });
    this.replacementFn = replacement;
  }

  *processChunk(chunk: string): Generator<string, void, undefined> {
    for (const { match, content } of this.searchStrategy.processChunk(
      chunk,
      this.searchState
    )) {
      if (!match) {
        yield content;
        continue;
      }
      yield* this.replacementFn(content, this.matchIndex++);
    }
  }
}
