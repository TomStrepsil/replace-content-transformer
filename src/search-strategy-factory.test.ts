import {
  createStringAnchorSearchStrategy,
  createRegexSearchStrategy
} from "./search-strategies/index.ts";
import { createSearchStrategy, searchStrategyFactory } from "./search-strategy-factory.ts";
import { describe, it, expect, vi } from "vitest";

vi.mock("./search-strategies/index.ts", () => ({
  createRegexSearchStrategy: vi.fn().mockReturnValue({ _type: "regex" }),
  createStringAnchorSearchStrategy: vi.fn().mockReturnValue({ _type: "string" })
}));

describe("createSearchStrategy", () => {
  describe("given a RegExp needle", () => {
    it("delegates to createRegexSearchStrategy", () => {
      const strategy = createSearchStrategy(/test-regex/);
      expect(createRegexSearchStrategy).toHaveBeenCalledWith(/test-regex/);
      expect(strategy).toEqual({ _type: "regex" });
    });
  });

  describe("given a string needle", () => {
    it("delegates to createStringAnchorSearchStrategy, wrapping the needle in an array", () => {
      const strategy = createSearchStrategy("test-needle");
      expect(createStringAnchorSearchStrategy).toHaveBeenCalledWith([
        "test-needle"
      ]);
      expect(strategy).toEqual({ _type: "string" });
    });
  });

  describe("given a string array needle", () => {
    it("delegates to createStringAnchorSearchStrategy, passing the array", () => {
      const strategy = createSearchStrategy([
        "test-needle-1",
        "test-needle-2"
      ]);
      expect(createStringAnchorSearchStrategy).toHaveBeenCalledWith([
        "test-needle-1",
        "test-needle-2"
      ]);
      expect(strategy).toEqual({ _type: "string" });
    });
  });

  it("should support deprecated searchStrategyFactory alias", () => {
    expect(searchStrategyFactory).toBe(createSearchStrategy);
  });
});
