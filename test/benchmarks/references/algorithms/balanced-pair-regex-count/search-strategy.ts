import { BalancedPairSearchStrategy } from "../../../../../src/search-strategies/balanced-pair/search-strategy.ts";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Variant of BalancedPairSearchStrategy that counts opening delimiters using
 * a pre-compiled RegExp + String.match() instead of a while/indexOf loop.
 * Exists only for benchmarking — not part of the public API.
 */
export class BalancedPairRegexCountSearchStrategy extends BalancedPairSearchStrategy {
  readonly #openingRegex: RegExp;

  constructor(opening: string, closing: string) {
    super(opening, closing);
    this.#openingRegex = new RegExp(escapeRegExp(opening), "g");
  }

  protected override countOpenings(content: string): number {
    return content.match(this.#openingRegex)?.length ?? 0;
  }
}
