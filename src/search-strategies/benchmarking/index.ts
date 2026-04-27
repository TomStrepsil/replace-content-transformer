/**
 * Benchmark and comparison search strategies
 *
 * These strategies are kept for performance comparison and research purposes.
 * For production use, see the main search-strategies exports (regex and buffered-indexOf-anchored).
 */

export { AnchorSequenceSearchStrategy } from "./anchor-sequence/search-strategy.js";
export { BufferedIndexOfAnchoredCallbackSearchStrategy } from "./buffered-indexOf-anchored-callback/search-strategy.js";
export { BufferedIndexOfReplaceContentTransformer } from "./buffered-indexOf-canonical/search-strategy.js";
export { BufferedIndexOfCanonicalAsGeneratorSearchStrategy } from "./buffered-indexOf-canonical-generator/search-strategy.js";
export {
  BufferedIndexOfCancellableSearchStrategy,
  type BufferedIndexOfCancellableSearchState
} from "./buffered-indexOf-cancellable/search-strategy.js";
export { BufferedIndexOfCallbackSearchStrategy } from "./buffered-indexOf-callback/search-strategy.js";
export {
  LoopedIndexOfCancellableSearchStrategy,
  type LoopedIndexOfCancellableSearchState
} from "./looped-indexOf-cancellable/search-strategy.js";
export { LoopedIndexOfCallbackSearchStrategy } from "./looped-indexOf-callback/search-strategy.js";
export { LoopedIndexOfAnchoredSearchStrategy } from "../looped-indexOf-anchored/search-strategy.js";
export {
  IndexOfKnuthMorrisPrattSearchStrategy,
  type IndexOfKnuthMorrisPrattSearchState
} from "./indexOf-knuth-morris-pratt/search-strategy.js";
export { RegexReplaceContentTransformer } from "./regex-canonical/search-strategy.js";
export { RegexCallbackSearchStrategy } from "./regex-callback/search-strategy.js";
