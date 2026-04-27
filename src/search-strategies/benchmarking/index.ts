/**
 * Benchmark and comparison search strategies
 *
 * These strategies are kept for performance comparison and research purposes.
 * For production use, see the main search-strategies exports (regex and buffered-indexOf-anchored).
 */

export { AnchorSequenceSearchStrategy } from "./anchor-sequence/search-strategy";
export { BufferedIndexOfAnchoredCallbackSearchStrategy } from "./buffered-indexOf-anchored-callback/search-strategy";
export { BufferedIndexOfReplaceContentTransformer } from "./buffered-indexOf-canonical/search-strategy";
export { BufferedIndexOfCanonicalAsGeneratorSearchStrategy } from "./buffered-indexOf-canonical-generator/search-strategy";
export {
  BufferedIndexOfCancellableSearchStrategy,
  type BufferedIndexOfCancellableSearchState
} from "./buffered-indexOf-cancellable/search-strategy";
export { BufferedIndexOfCallbackSearchStrategy } from "./buffered-indexOf-callback/search-strategy";
export {
  LoopedIndexOfCancellableSearchStrategy,
  type LoopedIndexOfCancellableSearchState
} from "./looped-indexOf-cancellable/search-strategy";
export { LoopedIndexOfCallbackSearchStrategy } from "./looped-indexOf-callback/search-strategy";
export { LoopedIndexOfAnchoredSearchStrategy } from "../looped-indexOf-anchored/search-strategy";
export {
  IndexOfKnuthMorrisPrattSearchStrategy,
  type IndexOfKnuthMorrisPrattSearchState
} from "./indexOf-knuth-morris-pratt/search-strategy";
export { RegexReplaceContentTransformer } from "./regex-canonical/search-strategy";
export { RegexCallbackSearchStrategy } from "./regex-callback/search-strategy";
