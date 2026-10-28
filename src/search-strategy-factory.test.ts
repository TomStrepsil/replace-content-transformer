import {
  StringAnchorSearchStrategy,
  RegexSearchStrategy
} from "./search-strategies/index.js";
import { searchStrategyFactory } from "./search-strategy-factory.js";
import { describe, it, expect, expectTypeOf } from "vitest";

vi.mock("./search-strategies/index.js");

describe("search strategy factory", () => {
  describe("given a RegExp needle", () => {
    it("creates RegexSearchStrategy", () => {
      const strategy = searchStrategyFactory(/test-regex/);
      expect(strategy).toBeInstanceOf(RegexSearchStrategy);
      expect(RegexSearchStrategy).toHaveBeenCalledWith(/test-regex/, undefined);
    });
  });

  describe("given a string needle", () => {
    it("creates StringAnchorSearchStrategy, passing the needle", () => {
      const strategy = searchStrategyFactory("test-needle");
      expect(strategy).toBeInstanceOf(StringAnchorSearchStrategy);
      expect(StringAnchorSearchStrategy).toHaveBeenCalledWith(
        ["test-needle"],
        undefined
      );
    });
  });

  describe("given a string array needle", () => {
    it("creates StringAnchorSearchStrategy, passing the array", () => {
      const strategy = searchStrategyFactory([
        "test-needle-1",
        "test-needle-2"
      ]);
      expect(strategy).toBeInstanceOf(StringAnchorSearchStrategy);
      expect(StringAnchorSearchStrategy).toHaveBeenCalledWith(
        ["test-needle-1", "test-needle-2"],
        undefined
      );
    });
  });

  describe("given options", () => {
    const options = { maxBufferLength: 8, onGuardExceeded: () => {} };

    it("passes them to RegexSearchStrategy", () => {
      searchStrategyFactory(/test-regex/, options);
      expect(RegexSearchStrategy).toHaveBeenLastCalledWith(/test-regex/, options);
    });

    it("passes them to StringAnchorSearchStrategy", () => {
      searchStrategyFactory(["{{", "}}"], options);
      expect(StringAnchorSearchStrategy).toHaveBeenLastCalledWith(
        ["{{", "}}"],
        options
      );
    });

    it("passes the backoff options to RegexSearchStrategy, given a RegExp needle", () => {
      const regexOptions = {
        ...options,
        minCandidateLengthToBackOff: 2048,
        bufferGrowthFactorBetweenEvaluations: 4
      };
      searchStrategyFactory(/test-regex/, regexOptions);
      expect(RegexSearchStrategy).toHaveBeenLastCalledWith(/test-regex/, regexOptions);
    });
  });

  describe("types", () => {
    it("returns the strategy for the needle's type, or either when only known at runtime", () => {
      expectTypeOf(searchStrategyFactory(/test-regex/)).toEqualTypeOf<RegexSearchStrategy>();
      expectTypeOf(searchStrategyFactory("{{")).toEqualTypeOf<StringAnchorSearchStrategy>();
      expectTypeOf(
        searchStrategyFactory(["{{", "}}"] as string[] | RegExp)
      ).toEqualTypeOf<RegexSearchStrategy | StringAnchorSearchStrategy>();
    });

    it("accepts the backoff options only for a RegExp needle, as only RegexSearchStrategy uses them", () => {
      searchStrategyFactory(/test-regex/, { minCandidateLengthToBackOff: 2048 });
      // @ts-expect-error a string needle takes only maxBufferLength and onGuardExceeded
      searchStrategyFactory("{{", { minCandidateLengthToBackOff: 2048 });
      // @ts-expect-error nor does a needle that may be a string
      searchStrategyFactory("{{" as string | RegExp, { minCandidateLengthToBackOff: 2048 });
    });
  });
});
