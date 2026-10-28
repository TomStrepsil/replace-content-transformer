import PartialMatchRegExp from "regex-partial-match";
import { isPartialMatchRegExp } from "regex-partial-match/features";
import { LeanRegexSearchStrategy } from "./lean-search-strategy.js";
import type { RegexSearchStrategyOptions } from "./types.js";

/**
 * A search strategy for finding patterns using regular expressions.
 *
 * This strategy enables powerful pattern matching using JavaScript RegExp, supporting
 * most standard regex features (capture groups, positive lookaheads, character classes, etc.).
 * It correctly handles matches that span chunk boundaries by maintaining a buffer and
 * using partial match detection to avoid splitting incomplete patterns.
 *
 * Given a `PartialMatchRegExp`, the strategy uses it as it is, so one built with
 * `withModules()` keeps its modules' options, such as a larger `longestPartial`
 * for backreferences. It must come from the copy of `regex-partial-match`
 * installed as this package's peer dependency; any other is rebuilt with the
 * default modules.
 *
 * To leave the full `PartialMatchRegExp` class out of a bundle, use
 * {@link LeanRegexSearchStrategy} with a `PartialMatchRegExp` built from
 * `regex-partial-match/core`.
 *
 * @throws If `needle` uses a construct whose truth a streaming scan cannot decide
 * at a chunk boundary — negative lookaheads, lookbehinds, word boundaries, the
 * `^`/`$` anchors — or the `g`, `y` or `m` flags. See [Limitations](./README.md#limitations).
 *
 * @throws {RangeError} If `maxBufferLength` or `minCandidateLengthToBackOff` is
 * not a number of at least 0, or `bufferGrowthFactorBetweenEvaluations` is not a
 * number of at least 1. `Infinity` is allowed; `undefined` selects the default.
 *
 * @example Basic regex search
 * ```typescript
 * import { searchStrategyFactory, SyncReplacementTransformEngine } from 'replace-content-transformer';
 *
 * // Factory automatically creates RegexSearchStrategy for RegExp input
 * const strategy = searchStrategyFactory(/\{\{(\w+)\}\}/);
 *
 * const engine = new SyncReplacementTransformEngine({
 *   searchStrategy: strategy,
 *   replacement: (match) => `Value: ${match[1]}`
 * });
 * ```
 */
export class RegexSearchStrategy extends LeanRegexSearchStrategy {
  constructor(needle: RegExp, options?: RegexSearchStrategyOptions) {
    super(
      isPartialMatchRegExp(needle) ? needle : new PartialMatchRegExp(needle),
      options
    );
  }
}
