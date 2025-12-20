import { describe, it, expect } from "vitest";
import { IterableFunctionReplacementProcessor } from "./iterable-function-replacement-processor.ts";
import { StringAnchorSearchStrategy } from "../search-strategies/index.ts";

describe("IterableFunctionReplacementProcessor + BufferedIndexOfCancellableSearchStrategy", () => {
  it("should support recursive replacement", async () => {
    const searchStrategy = new StringAnchorSearchStrategy(["tock"]);

    function* replace(
      depth: number,
      match: string
    ): Generator<string, void, undefined> {
      if (depth > 1) {
        return yield match;
      }

      const processor = new IterableFunctionReplacementProcessor({
        searchStrategy: searchStrategy,
        replacement: replace.bind(null, depth + 1)
      });

      yield* processor.processChunk("tock follows tick follows tock");
    }

    const processor = new IterableFunctionReplacementProcessor({
      searchStrategy: searchStrategy,
      replacement: replace.bind(null, 0)
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk("tick follows tock")) {
      outputChunks.push(chunk);
    }

    expect(outputChunks.join("")).toEqual(
      "tick follows tock follows tick follows tock follows tick follows tock follows tick follows tock"
    );
  });
});
