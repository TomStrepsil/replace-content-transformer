/**
 * Engine shapes kept for performance comparison: the replacement fused into a transformer,
 * a callback or a generator, and a search strategy that yields results to a generator
 * engine. The production shape is a {@link SearchStrategy} reporting to a sink.
 */

export { BufferedIndexOfAnchoredCallbackSearchStrategy } from "./fused-callback/buffered-indexOf-anchored/search-strategy.ts";
export { BufferedIndexOfReplaceContentTransformer } from "./fused-transformer/buffered-indexOf/search-strategy.ts";
export { BufferedIndexOfCanonicalAsGeneratorSearchStrategy } from "./fused-generator/buffered-indexOf/search-strategy.ts";
export { BufferedIndexOfCallbackSearchStrategy } from "./fused-callback/buffered-indexOf/search-strategy.ts";
export { LoopedIndexOfCallbackSearchStrategy } from "./fused-callback/looped-indexOf/search-strategy.ts";
export { RegexReplaceContentTransformer } from "./fused-transformer/regex/search-strategy.ts";
export { RegexCallbackSearchStrategy } from "./fused-callback/regex/search-strategy.ts";
export { GeneratorSyncTransformEngine } from "./generator-engine/engine.ts";
export { LoopedIndexOfAnchoredGeneratorSearchStrategy } from "./generator-engine/looped-indexOf-anchored/search-strategy.ts";
export type { GeneratorSearchStrategy } from "./generator-engine/types.ts";
