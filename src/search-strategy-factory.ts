import {
  StringAnchorSearchStrategy,
  RegexSearchStrategy,
  type BufferGuardOptions
} from "./search-strategies/index.js";

/**
 * Creates an appropriate search strategy based on the needle type.
 * 
 * This factory function automatically selects the best search strategy implementation:
 * - For string or string[] patterns: Uses {@link StringAnchorSearchStrategy} (indexOf-based)
 * - For RegExp patterns: Uses {@link RegexSearchStrategy} (regex-based)
 * 
 * @param needle - The pattern to search for. Can be a string, array of strings, or RegExp.
 * @param options - The ceiling on held-back content, passed to whichever strategy is built.
 * @returns A search strategy instance configured for the given pattern type.
 * @throws If a string needle is empty, or a string array is empty or contains an empty string.
 * @throws If a RegExp needle uses a construct or flag the streaming scan cannot support — see {@link RegexSearchStrategy}.
 * @throws {TypeError} If `maxBufferLength` is not a number.
 * @throws {RangeError} If `maxBufferLength` is less than 0, or `NaN`.
 * 
 * @example
 * ```typescript
 * import { searchStrategyFactory, SyncReplacementTransformEngine } from 'replace-content-transformer';
 * 
 * // String search
 * const stringStrategy = searchStrategyFactory('{{placeholder}}');
 * const engine = new SyncReplacementTransformEngine({
 *   searchStrategy: stringStrategy,
 *   replacement: 'value'
 * });
 * 
 * // Regex search
 * const regexStrategy = searchStrategyFactory(/\{\{(\w+?)\}\}/);
 * ```
 */
const searchStrategyFactory = (
  needle: string | string[] | RegExp,
  options?: BufferGuardOptions
) => {
  if (needle instanceof RegExp) {
    return new RegexSearchStrategy(needle, options);
  } else {
    return new StringAnchorSearchStrategy([needle].flat(), options);
  }
};

export { searchStrategyFactory };
