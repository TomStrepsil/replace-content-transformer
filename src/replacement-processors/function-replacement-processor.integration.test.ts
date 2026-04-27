import { describe, it, expect } from "vitest";
import {
  StringAnchorSearchStrategy,
  RegexSearchStrategy
} from "../search-strategies/index.js";
import { FunctionReplacementProcessor } from "./function-replacement-processor.js";

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

describe("FunctionReplacementProcessor + RegexSearchStrategy", () => {
  it("provides full match via index [0]", () => {
    const processor = new FunctionReplacementProcessor({
      searchStrategy: new RegexSearchStrategy(/\{\{(\w+)\}\}/),
      replacement: (match) => {
        return `[FULL:${match[0]}]`;
      }
    });

    const results = [
      ...Array.from(processor.processChunk("before {{name}} after")),
      processor.flush()
    ];

    expect(results.join("")).toEqual("before [FULL:{{name}}] after");
  });

  it("provides numbered capture groups via indices [1], [2], etc.", () => {
    const processor = new FunctionReplacementProcessor({
      searchStrategy: new RegexSearchStrategy(/\{\{(\w+):(\w+)\}\}/),
      replacement: (match) => {
        return `[GROUP1:${match[1]}|GROUP2:${match[2]}]`;
      }
    });

    const results = [
      ...Array.from(processor.processChunk("value is {{type:value}} here")),
      processor.flush()
    ];

    expect(results.join("")).toEqual(
      "value is [GROUP1:type|GROUP2:value] here"
    );
  });

  it("provides named capture groups via .groups property", () => {
    const processor = new FunctionReplacementProcessor({
      searchStrategy: new RegexSearchStrategy(
        /\{\{(?<key>\w+):(?<val>\w+)\}\}/
      ),
      replacement: (match) => {
        return `[KEY:${match.groups?.key}|VAL:${match.groups?.val}]`;
      }
    });

    const results = [
      ...Array.from(processor.processChunk("data is {{name:john}} here")),
      processor.flush()
    ];

    expect(results.join("")).toEqual("data is [KEY:name|VAL:john] here");
  });

  it("handles multiple matches with different capture group values", () => {
    const matchedGroups: Array<{ full: string; group1: string }> = [];

    const processor = new FunctionReplacementProcessor({
      searchStrategy: new RegexSearchStrategy(/\[(\w+)\]/),
      replacement: (match) => {
        matchedGroups.push({ full: match[0], group1: match[1] });
        return `<${match[1]}>`;
      }
    });

    const results = [
      ...Array.from(processor.processChunk("test [alpha] and [beta] end")),
      processor.flush()
    ];

    expect(results.join("")).toEqual("test <alpha> and <beta> end");
    expect(matchedGroups).toEqual([
      { full: "[alpha]", group1: "alpha" },
      { full: "[beta]", group1: "beta" }
    ]);
  });
});
