import { describe, expect, it } from "vitest";
import {
  AnchorSequenceSearchStrategy,
  BufferedIndexOfAnchoredSearchStrategy,
  BufferedIndexOfCancellableSearchStrategy,
  IndexOfKnuthMorrisPrattSearchStrategy,
  LoopedIndexOfCancellableSearchStrategy
} from "./index.ts";
import { BalancedPairRegexCountSearchStrategy } from "./balanced-pair-regex-count/search-strategy.ts";
import { RegexSearchStrategy } from "../../../../src/search-strategies/regex/index.ts";
import type { SearchStrategy } from "../../../../src/search-strategies/types.ts";
import {
  collectPausedSearchStrategyResults,
  collectSearchStrategyResults,
  collectStoppedSearchStrategyResults
} from "../../../utilities.ts";
import { everySplitOf } from "../../../splits.ts";

const cases: {
  name: string;
  create: () => SearchStrategy<unknown, unknown>;
  input: string;
}[] = [
  {
    name: "LoopedIndexOfCancellable",
    create: () => new LoopedIndexOfCancellableSearchStrategy("{{x}}"),
    input: "a{{x}}b{{x}}{{x}}c"
  },
  {
    name: "IndexOfKnuthMorrisPratt",
    create: () => new IndexOfKnuthMorrisPrattSearchStrategy("{{x}}"),
    input: "a{{x}}b{{x}}{{x}}c"
  },
  {
    name: "BufferedIndexOfCancellable",
    create: () => new BufferedIndexOfCancellableSearchStrategy("{{x}}"),
    input: "a{{x}}b{{x}}{{x}}c"
  },
  {
    name: "BufferedIndexOfAnchored",
    create: () => new BufferedIndexOfAnchoredSearchStrategy(["{{", "}}"]),
    input: "a{{x}}b{{y}}{{z}}c"
  },
  {
    name: "BalancedPairRegexCount",
    create: () => new BalancedPairRegexCountSearchStrategy("{{", "}}"),
    input: "a{{x{{y}}}}b{{z}}c"
  },
  {
    name: "AnchorSequence of LoopedIndexOfCancellable",
    create: () =>
      new AnchorSequenceSearchStrategy([
        new LoopedIndexOfCancellableSearchStrategy("{{"),
        new LoopedIndexOfCancellableSearchStrategy("}}")
      ]),
    input: "a{{x}}b{{y}}{{z}}c"
  },
  {
    name: "AnchorSequence of BufferedIndexOfCancellable",
    create: () =>
      new AnchorSequenceSearchStrategy([
        new BufferedIndexOfCancellableSearchStrategy("{{"),
        new BufferedIndexOfCancellableSearchStrategy("}}")
      ]),
    input: "a{{x}}b{{y}}{{z}}c"
  },
  {
    name: "AnchorSequence settling a held match with a tail",
    create: () =>
      new AnchorSequenceSearchStrategy([
        new RegexSearchStrategy(/a/),
        new RegexSearchStrategy(/b.*d|b/)
      ]),
    input: "xabxab"
  },
  {
    name: "AnchorSequence settling a held match mid-sequence",
    create: () =>
      new AnchorSequenceSearchStrategy([
        new RegexSearchStrategy(/a/),
        new RegexSearchStrategy(/b.*d|b/),
        new RegexSearchStrategy(/c/)
      ]),
    input: "xabcabc"
  }
];

describe("benchmark strategies stopped at a match", () => {
  describe.each(cases)("$name", ({ create, input }) => {
    it("carries on from each match exactly as an uninterrupted run", () => {
      for (const chunks of everySplitOf(input)) {
        const { results, settledResults } = collectSearchStrategyResults(
          create(),
          chunks
        );
        expect(
          collectPausedSearchStrategyResults(create(), chunks),
          chunks.join("|")
        ).toEqual([...results, ...settledResults]);
      }
    });

    it("flushes everything after the match it stopped at", () => {
      for (const chunks of everySplitOf(input)) {
        const { results, settledResults } = collectSearchStrategyResults(
          create(),
          chunks
        );
        const matches = [...results, ...settledResults].filter(
          (result) => result.isMatch
        ).length;
        for (let limit = 1; limit <= matches; limit++) {
          const { stopped, output } = collectStoppedSearchStrategyResults(
            create(),
            chunks,
            limit
          );
          expect(stopped).toBe(true);
          expect(output, `${chunks.join("|")} after ${limit}`).toBe(input);
        }
      }
    });
  });
});
