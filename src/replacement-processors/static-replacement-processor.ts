import {
  ReplacementProcessorBase,
  createProcessorBase,
  type ReplacementProcessorOptions
} from "./replacement-processor.base.ts";
import { type SyncProcessor } from "./types.ts";

/**
 * Configuration options for {@link createStaticReplacementProcessor}.
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
 * Creates a replacement processor that replaces all matches with a static string value.
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
 * import { createStaticReplacementProcessor, createSearchStrategy } from 'replace-content-transformer';
 * import { createReplaceContentTransformer } from 'replace-content-transformer/web';
 * 
 * const processor = createStaticReplacementProcessor({
 *   searchStrategy: createSearchStrategy('{{placeholder}}'),
 *   replacement: 'Hello, World!'
 * });
 * 
 * const transformer = createReplaceContentTransformer(processor);
 * const stream = new TransformStream(transformer);
 * ```
 */
export function createStaticReplacementProcessor<TState, TMatch = string>({
  searchStrategy,
  replacement
}: StaticReplacementProcessorOptions<TState, TMatch>): SyncProcessor {
  const { searchState, flush } = createProcessorBase(searchStrategy);

  return {
    *processChunk(chunk: string): Generator<string, void, undefined> {
      for (const { isMatch, content } of searchStrategy.processChunk(
        chunk,
        searchState
      )) {
        yield isMatch ? replacement : content;
      }
    },
    flush
  };
}

/**
 * @deprecated Use {@link createStaticReplacementProcessor} instead.
 */
export class StaticReplacementProcessor<
  TState,
  TMatch = string
> extends ReplacementProcessorBase<TState, TMatch> implements SyncProcessor {
  #processor: SyncProcessor;

  constructor(options: StaticReplacementProcessorOptions<TState, TMatch>) {
    super(options);
    this.#processor = createStaticReplacementProcessor(options);
  }

  *processChunk(chunk: string): Generator<string, void, undefined> {
    yield* this.#processor.processChunk(chunk);
  }

  flush(): string {
    return this.#processor.flush();
  }
}
