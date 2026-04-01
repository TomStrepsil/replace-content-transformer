import {
  createStringAnchorSearchStrategy,
  createRegexSearchStrategy
} from "./search-strategies/index.ts";

/**
 * Creates an appropriate search strategy based on the needle type.
 * 
 * This factory function automatically selects the best search strategy implementation:
 * - For string or string[] patterns: Uses {@link createStringAnchorSearchStrategy} (indexOf-based)
 * - For RegExp patterns: Uses {@link createRegexSearchStrategy} (regex-based)
 * 
 * @param needle - The pattern to search for. Can be a string, array of strings, or RegExp.
 * @returns A search strategy instance configured for the given pattern type.
 * 
 * @example
 * ```typescript
 * import { createSearchStrategy, createStaticReplacementProcessor } from 'replace-content-transformer';
 * 
 * // String search
 * const stringStrategy = createSearchStrategy('{{placeholder}}');
 * const processor = createStaticReplacementProcessor({
 *   searchStrategy: stringStrategy,
 *   replacement: 'value'
 * });
 * 
 * // Regex search
 * const regexStrategy = createSearchStrategy(/\{\{(\w+?)\}\}/);
 * ```
 */
const createSearchStrategy = (needle: string | string[] | RegExp) => {
  if (needle instanceof RegExp) {
    return createRegexSearchStrategy(needle);
  } else {
    return createStringAnchorSearchStrategy([needle].flat());
  }
};

/**
 * @deprecated Use {@link createSearchStrategy} instead.
 */
const searchStrategyFactory = createSearchStrategy;

export { createSearchStrategy, searchStrategyFactory };
