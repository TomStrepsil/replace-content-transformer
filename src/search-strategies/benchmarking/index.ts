/**
 * Benchmark and comparison search strategies
 *
 * These strategies are kept for performance comparison and research purposes.
 * For production use, see the main search-strategies exports (regex and buffered-indexOf-anchored).
 */

export { AnchorSequenceSearchStrategy } from "./anchor-sequence/search-strategy.ts";
export { BufferedIndexOfAnchoredCallbackSearchStrategy } from "./buffered-indexOf-anchored-callback/search-strategy.ts";
export { BufferedIndexOfReplaceContentTransformer } from "./buffered-indexOf-canonical/search-strategy.ts";
export { BufferedIndexOfCanonicalAsGeneratorSearchStrategy } from "./buffered-indexOf-canonical-generator/search-strategy.ts";
export {
  BufferedIndexOfCancellableSearchStrategy,
  type BufferedIndexOfCancellableSearchState
} from "./buffered-indexOf-cancellable/search-strategy.ts";
export { BufferedIndexOfCallbackSearchStrategy } from "./buffered-indexOf-callback/search-strategy.ts";
export {
  LoopedIndexOfCancellableSearchStrategy,
  type LoopedIndexOfCancellableSearchState
} from "./looped-indexOf-cancellable/search-strategy.ts";
export { LoopedIndexOfCallbackSearchStrategy } from "./looped-indexOf-callback/search-strategy.ts";
export { LoopedIndexOfAnchoredSearchStrategy } from "../looped-indexOf-anchored/search-strategy.ts";
export {
  IndexOfKnuthMorrisPrattSearchStrategy,
  type IndexOfKnuthMorrisPrattSearchState
} from "./indexOf-knuth-morris-pratt/search-strategy.ts";
export { RegexReplaceContentTransformer } from "./regex-canonical/search-strategy.ts";
export { RegexCallbackSearchStrategy } from "./regex-callback/search-strategy.ts";
