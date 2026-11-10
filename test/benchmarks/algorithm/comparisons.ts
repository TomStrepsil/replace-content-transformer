import * as harnesses from "../harnesses/index.ts";
import type { BaseHarness } from "../harnesses/types.ts";

/**
 * Harnesses compared with a baseline that reports to a sink through the
 * production engines. Every baseline is a shipped strategy except Buffered
 * IndexOf Anchored, a reference carrying the algorithm of the fused shapes it
 * is compared with. See the references README for what each comparison holds
 * fixed.
 */
export interface Comparison {
  name: string;
  question: string;
  baseline: BaseHarness;
  compared: BaseHarness[];
}

export const comparisons: Comparison[] = [
  {
    name: "Search algorithms",
    question: "Which algorithm finds anchors fastest, in the production shape and the sync engine?",
    baseline: harnesses.LoopedIndexOfAnchoredHarness,
    compared: [
      harnesses.BufferedIndexOfAnchoredHarness,
      harnesses.RegexHarness,
      harnesses.LoopedIndexOfAnchorSequenceHarness,
      harnesses.BufferedIndexOfAnchorSequenceHarness,
      harnesses.KMPAnchorSequenceHarness,
      harnesses.RegexAnchorSequenceHarness
    ]
  },
  {
    name: "Nesting count",
    question: "Does a pre-compiled regex count opening delimiters faster than a while/indexOf loop?",
    baseline: harnesses.BalancedPairHarness,
    compared: [harnesses.BalancedPairRegexCountHarness]
  },
  {
    name: "Sync vs async engine",
    question: "What does the async serial engine cost over the sync one?",
    baseline: harnesses.LoopedIndexOfAnchoredHarness,
    compared: [harnesses.LoopedIndexOfAnchoredAsyncHarness]
  },
  {
    name: "Engine shapes: looped-indexOf",
    question: "What does reporting to a sink cost, against a generator engine or a fused callback?",
    baseline: harnesses.LoopedIndexOfAnchoredHarness,
    compared: [harnesses.LoopedIndexOfAnchoredGeneratorHarness, harnesses.LoopedIndexOfCallbackHarness]
  },
  {
    name: "Engine shapes: buffered-indexOf",
    question: "What does reporting to a sink cost, against fused callbacks, a fused generator or a fused Transformer?",
    baseline: harnesses.BufferedIndexOfAnchoredHarness,
    compared: [
      harnesses.BufferedIndexOfAnchoredCallbackHarness,
      harnesses.BufferedIndexOfCallbackHarness,
      harnesses.BufferedIndexOfCanonicalHarness,
      harnesses.BufferedIndexOfGeneratorHarness
    ]
  },
  {
    name: "Engine shapes: regex",
    question: "What does reporting to a sink cost, against a fused callback or a fused Transformer?",
    baseline: harnesses.RegexHarness,
    compared: [harnesses.RegexCallbackHarness, harnesses.RegexCanonicalHarness]
  }
];
