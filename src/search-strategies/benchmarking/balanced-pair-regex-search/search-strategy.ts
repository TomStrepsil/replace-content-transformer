import { BalancedPairSearchStrategy } from "../../balanced-pair/search-strategy.ts";
import type { BalancedPairSearchState } from "../../balanced-pair/search-strategy.ts";
import HeldText from "../../held-text.ts";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class RegexHeldText extends HeldText {
  private readonly patterns: RegExp[];

  constructor(anchors: readonly string[], patterns: RegExp[]) {
    super(anchors);
    this.patterns = patterns;
  }

  protected override search(text: string, anchorIndex: number, from: number): number {
    const pattern = this.patterns[anchorIndex];
    pattern.lastIndex = from;
    return pattern.exec(text)?.index ?? -1;
  }
}

/**
 * Variant of BalancedPairSearchStrategy that finds each delimiter with a RegExp,
 * compiled once at construction, instead of indexOf.
 * Exists only for benchmarking — not part of the public API.
 */
export class BalancedPairRegexSearchStrategy extends BalancedPairSearchStrategy {
  private readonly anchors: [opening: string, closing: string];
  private readonly patterns: RegExp[];

  constructor(opening: string, closing: string) {
    super(opening, closing);
    this.anchors = [opening, closing];
    this.patterns = this.anchors.map((anchor) => new RegExp(escapeRegExp(anchor), "g"));
  }

  override createState(): BalancedPairSearchState {
    return {
      ...super.createState(),
      held: new RegexHeldText(this.anchors, this.patterns)
    };
  }
}
