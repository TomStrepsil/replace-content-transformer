import { describe, it, expect } from "vitest";
import { StringAnchorSearchStrategy } from "../search-strategies/index.ts";
import { FunctionReplacementProcessor } from "./function-replacement-processor.ts";

describe("FunctionReplacementProcessor + StringAnchorSearchStrategy", () => {
  it("simple match", () => {
    const strategy = new StringAnchorSearchStrategy(["{{"]);
    const processor = new FunctionReplacementProcessor({
      searchStrategy: strategy,
      replacement: () => "REPLACED"
    });

    const results = [
      ...Array.from(processor.processChunk("before {{ after")),
      processor.flush()
    ];

    expect(results.join("")).toEqual("before REPLACED after");
  });

  it("cross-chunk match", () => {
    const strategy = new StringAnchorSearchStrategy(["{{"]);
    const processor = new FunctionReplacementProcessor({
      searchStrategy: strategy,
      replacement: () => "REPLACED"
    });

    const results = [
      ...Array.from(processor.processChunk("before {")),
      ...Array.from(processor.processChunk("{ after")),
      processor.flush()
    ];

    expect(results.join("")).toEqual("before REPLACED after");
  });

  it("invalid partial match", () => {
    const strategy = new StringAnchorSearchStrategy(["{{"]);
    const processor = new FunctionReplacementProcessor({
      searchStrategy: strategy,
      replacement: () => "REPLACED"
    });

    const results = [
      ...Array.from(processor.processChunk("{")),
      ...Array.from(processor.processChunk("x{{y")),
      processor.flush()
    ];

    expect(results.join("")).toEqual("{xREPLACEDy");
  });
});
