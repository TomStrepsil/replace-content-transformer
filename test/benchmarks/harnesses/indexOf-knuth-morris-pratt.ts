import { SerialTransformEngine } from "../../../src/engines/serial-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import type { ReplacementContext } from "../../../src/engines/types.ts";
import {
  AnchorSequenceSearchStrategy,
  IndexOfKnuthMorrisPrattSearchStrategy,
  type IndexOfKnuthMorrisPrattSearchState
} from "../references/algorithms/index.ts";

export const KMPAnchorSequenceHarness = {
  name: "KMP + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) =>
    new AnchorSequenceSearchStrategy<IndexOfKnuthMorrisPrattSearchState>(
      tokens.map((token) => new IndexOfKnuthMorrisPrattSearchStrategy(token))
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<IndexOfKnuthMorrisPrattSearchState>;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SerialTransformEngine({
        searchStrategy: strategy,
        replacement
      })
    )
};
