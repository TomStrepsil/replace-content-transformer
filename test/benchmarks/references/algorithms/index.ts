/**
 * Benchmark and comparison search strategies
 *
 * These strategies are kept for performance comparison and research purposes.
 * They all implement `SearchStrategy`, so they run through the production engines. Engine
 * shapes (fused transformers, callbacks, generators) are in `../engine-shapes`.
 * For production use, see the main search-strategies exports.
 */

export { AnchorSequenceSearchStrategy } from "./anchor-sequence/search-strategy.ts";
export {
  BufferedIndexOfCancellableSearchStrategy,
  type BufferedIndexOfCancellableSearchState
} from "./buffered-indexOf-cancellable/search-strategy.ts";
export {
  LoopedIndexOfCancellableSearchStrategy,
  type LoopedIndexOfCancellableSearchState
} from "./looped-indexOf-cancellable/search-strategy.ts";
export {
  IndexOfKnuthMorrisPrattSearchStrategy,
  type IndexOfKnuthMorrisPrattSearchState
} from "./indexOf-knuth-morris-pratt/search-strategy.ts";
export { BufferedIndexOfAnchoredSearchStrategy } from "./buffered-indexOf-anchored/search-strategy.ts";
