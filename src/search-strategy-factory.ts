import {
  StringAnchorSearchStrategy,
  RegexSearchStrategy,
  type BufferGuardOptions,
  type RegexSearchStrategyOptions
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
 * For a RegExp needle, these may also include {@link RegexSearchStrategy}'s backoff options,
 * `minCandidateLengthToBackOff` and `bufferGrowthFactorBetweenEvaluations`.
 * @returns A search strategy instance configured for the given pattern type.
 * @throws If a string needle is empty, or a string array is empty or contains an empty string.
 * @throws If a RegExp needle uses a construct or flag the streaming scan cannot support — see {@link RegexSearchStrategy}.
 * @throws {TypeError} If `maxBufferLength`, or a backoff option given for a RegExp needle, is not a number.
 * @throws {RangeError} If `maxBufferLength` or `minCandidateLengthToBackOff` is less than 0,
 * `bufferGrowthFactorBetweenEvaluations` is less than 1, or either is `NaN`.
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
 *
 * // Regex search, re-scanning a long candidate less often
 * const throttledStrategy = searchStrategyFactory(/\S+/, {
 *   bufferGrowthFactorBetweenEvaluations: 4
 * });
 * ```
 */
function searchStrategyFactory(
  needle: RegExp,
  options?: RegexSearchStrategyOptions
): RegexSearchStrategy;
/** Creates a {@link StringAnchorSearchStrategy} for a string or sequence of strings. */
function searchStrategyFactory(
  needle: string | string[],
  options?: BufferGuardOptions
): StringAnchorSearchStrategy;
/** Creates a strategy for a needle whose type is known only at runtime. */
function searchStrategyFactory(
  needle: string | string[] | RegExp,
  options?: BufferGuardOptions
): RegexSearchStrategy | StringAnchorSearchStrategy;
function searchStrategyFactory(
  needle: string | string[] | RegExp,
  options?: RegexSearchStrategyOptions
): RegexSearchStrategy | StringAnchorSearchStrategy {
  if (needle instanceof RegExp) {
    return new RegexSearchStrategy(needle, options);
  } else {
    return new StringAnchorSearchStrategy([needle].flat(), options);
  }
}

export { searchStrategyFactory };
