import {
  StringAnchorSearchStrategy,
  RegexSearchStrategy
} from "./search-strategies/index.ts";
import { searchStrategyFactory } from "./search-strategy-factory.ts";
import { describe, it, expect } from "vitest";

vi.mock("./search-strategies/index.ts");

describe("search strategy factory", () => {
  describe("given a RegExp needle", () => {
    it("creates RegexSearchStrategy", () => {
      const strategy = searchStrategyFactory(/test-regex/);
      expect(strategy).toBeInstanceOf(RegexSearchStrategy);
      expect(RegexSearchStrategy).toHaveBeenCalledWith(/test-regex/);
    });
  });

  describe("given a string needle", () => {
    it("creates StringAnchorSearchStrategy, passing the needle", () => {
      const strategy = searchStrategyFactory("test-needle");
      expect(strategy).toBeInstanceOf(StringAnchorSearchStrategy);
      expect(StringAnchorSearchStrategy).toHaveBeenCalledWith([
        "test-needle"
      ]);
    });
  });

  describe("given a string array needle", () => {
    it("creates StringAnchorSearchStrategy, passing the array", () => {
      const strategy = searchStrategyFactory([
        "test-needle-1",
        "test-needle-2"
      ]);
      expect(strategy).toBeInstanceOf(StringAnchorSearchStrategy);
      expect(StringAnchorSearchStrategy).toHaveBeenCalledWith([
        "test-needle-1",
        "test-needle-2"
      ]);
    });
  });
});
