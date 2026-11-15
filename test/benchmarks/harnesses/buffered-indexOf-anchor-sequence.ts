import { SerialTransformEngine } from "../../../src/engines/serial-transform-engine.ts";
import { syncHarnessTransformer } from "./engine-harness.ts";
import type { ReplacementContext } from "../../../src/engines/types.ts";
import {
  AnchorSequenceSearchStrategy,
  BufferedIndexOfCancellableSearchStrategy,
  type BufferedIndexOfCancellableSearchState
} from "../references/algorithms/index.ts";

export const BufferedIndexOfAnchorSequenceHarness = {
  name: "Buffered IndexOf + Anchor Sequence",
  isAsync: false,
  createSearchStrategy: ({
    tokens
  }: {
    tokens: string[];
    replacement?: (match: string, context: ReplacementContext) => string;
  }) =>
    new AnchorSequenceSearchStrategy<BufferedIndexOfCancellableSearchState>(
      tokens.map((token) => new BufferedIndexOfCancellableSearchStrategy(token))
    ),
  createTransformer: ({
    strategy,
    replacement
  }: {
    strategy: AnchorSequenceSearchStrategy<BufferedIndexOfCancellableSearchState>;
    replacement: (match: string, context: ReplacementContext) => string;
  }) =>
    syncHarnessTransformer(
      new SerialTransformEngine({
        searchStrategy: strategy,
        replacement
      })
    )
};
