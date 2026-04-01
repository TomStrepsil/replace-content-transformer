import {
  ReplacementProcessorBase,
  createProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";
import { type SyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link createIterableFunctionReplacementProcessor}.
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
   * @returns An iterable of replacement strings
   */
  replacement: (match: TMatch, index: number) => Iterable<string>;
};

/**
 * Creates a replacement processor that uses a function returning an iterable to generate replacement values.
 *
 * This processor is useful when each match should be replaced with multiple strings that can be
 * generated synchronously. The replacement function returns an iterable (array, generator, etc.)
 * and all values are yielded in sequence. Processing is synchronous and compatible with both
 * WHATWG Streams and Node.js Transform streams.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 *
 * @example Replace with multiple strings
 * ```typescript
 * import { createIterableFunctionReplacementProcessor, createSearchStrategy } from 'replace-content-transformer';
 * import { createReplaceContentTransformer } from 'replace-content-transformer/web';
 *
 * const processor = createIterableFunctionReplacementProcessor({
 *   searchStrategy: createSearchStrategy('{{list}}'),
 *   replacement: (match, index) => ['Item 1', 'Item 2', 'Item 3']
 * });
 *
 * const transformer = createReplaceContentTransformer(processor);
 * ```
 *
 * @example Use a generator for lazy evaluation
 * ```typescript
 * const processor = createIterableFunctionReplacementProcessor({
 *   searchStrategy: createSearchStrategy('{{repeat}}'),
 *   replacement: function* (match, index) {
 *     for (let i = 0; i < 5; i++) {
 *       yield `Iteration ${i}\n`;
 *     }
 *   }
 * });
 * ```
 */
export function createIterableFunctionReplacementProcessor<TState, TMatch = string>({
  searchStrategy,
  replacement
}: IterableFunctionReplacementProcessorOptions<TState, TMatch>): SyncProcessor {
  const { searchState, flush } = createProcessorBase(searchStrategy);
  let matchIndex = 0;

  return {
    *processChunk(chunk: string): Generator<string, void, undefined> {
      for (const { isMatch, content } of searchStrategy.processChunk(
        chunk,
        searchState
      )) {
        if (!isMatch) {
          yield content;
          continue;
        }
        yield* replacement(content, matchIndex++);
      }
    },
    flush
  };
}

/**
 * @deprecated Use {@link createIterableFunctionReplacementProcessor} instead.
 */
export class IterableFunctionReplacementProcessor<
  TState,
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> implements SyncProcessor {
  #processor: SyncProcessor;

  constructor(options: IterableFunctionReplacementProcessorOptions<TState, TMatch>) {
    super(options);
    this.#processor = createIterableFunctionReplacementProcessor(options);
  }

  *processChunk(chunk: string): Generator<string, void, undefined> {
    yield* this.#processor.processChunk(chunk);
  }

  flush(): string {
    return this.#processor.flush();
  }
}
