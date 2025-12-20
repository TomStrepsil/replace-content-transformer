import {
  StringAnchorSearchStrategy,
  RegexSearchStrategy
} from "./search-strategies/index.ts";

/**
 * Creates an appropriate search strategy based on the needle type.
 * 
 * This factory function automatically selects the best search strategy implementation:
 * - For string or string[] patterns: Uses {@link StringAnchorSearchStrategy} (indexOf-based)
 * - For RegExp patterns: Uses {@link RegexSearchStrategy} (regex-based)
 * 
 * @param needle - The pattern to search for. Can be a string, array of strings, or RegExp.
 * @returns A search strategy instance configured for the given pattern type.
 * 
 * @example
 * ```typescript
 * import { searchStrategyFactory, StaticReplacementProcessor } from 'replace-content-transformer';
 * 
 * // String search
 * const stringStrategy = searchStrategyFactory('{{placeholder}}');
 * const processor = new StaticReplacementProcessor({
 *   searchStrategy: stringStrategy,
 *   replacement: 'value'
 * });
 * 
 * // Regex search
 * const regexStrategy = searchStrategyFactory(/\{\{(\w+?)\}\}/);
 * ```
 */
const searchStrategyFactory = (needle: string | string[] | RegExp) => {
  if (needle instanceof RegExp) {
    return new RegexSearchStrategy(needle);
  } else {
    return new StringAnchorSearchStrategy([needle].flat());
  }
};

export { searchStrategyFactory };
