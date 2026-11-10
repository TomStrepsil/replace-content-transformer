import { describe, expect, it } from "vitest";
import { LoopedIndexOfAnchoredGeneratorSearchStrategy } from "./search-strategy.ts";
import { LoopedIndexOfAnchoredSearchStrategy } from "../../../../../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";
import type { BufferGuardOptions } from "../../../../../../src/search-strategies/types.ts";
import { collectSearchStrategyResults } from "../../../../../utilities.ts";
import { everySplitOf } from "../../../../../splits.ts";

describe("LoopedIndexOfAnchoredGeneratorSearchStrategy", () => {
  it.each<[string, string[], BufferGuardOptions | undefined, string]>([
    ["two anchors", ["{{", "}}"], undefined, "a{{x}}b{{y}}{{z"],
    ["three anchors", ["<", "=", ">"], undefined, "<a=b><=><c"],
    ["an over-long match", ["{{", "}}"], { maxBufferLength: 6 }, "{{abcd}}{{x}}{{y"]
  ])("yields what the shipped strategy reports, for %s", (_label, needles, options, input) => {
    for (const chunks of everySplitOf(input)) {
      const generator = new LoopedIndexOfAnchoredGeneratorSearchStrategy(needles, options);
      const state = generator.createState();
      const yielded = chunks.flatMap((chunk) => [...generator.processChunk(chunk, state)]);
      const { results } = collectSearchStrategyResults(
        new LoopedIndexOfAnchoredSearchStrategy(needles, options),
        chunks
      );

      expect(yielded, chunks.join("|")).toEqual(results);
      expect(generator.flush(state)).toBe(
        input.slice(yielded.map((result) => result.content).join("").length)
      );
    }
  });
});
