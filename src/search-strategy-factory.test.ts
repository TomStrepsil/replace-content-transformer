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

    it("passes the options on, the backoff options included", () => {
      const options = {
        maxBufferLength: 100,
        onGuardExceeded: vi.fn(),
        minCandidateLengthToBackOff: 10
      };
      searchStrategyFactory(/test-regex/, options);
      expect(RegexSearchStrategy).toHaveBeenLastCalledWith(/test-regex/, options);
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

    it("passes the options on", () => {
      const options = { maxBufferLength: 100, onGuardExceeded: vi.fn() };
      searchStrategyFactory("test-needle", options);
      expect(StringAnchorSearchStrategy).toHaveBeenLastCalledWith(
        ["test-needle"],
        options
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

  describe("types", () => {
    it("returns the strategy built for the needle's type", () => {
      expectTypeOf(searchStrategyFactory(/x/)).toEqualTypeOf<RegexSearchStrategy>();
      expectTypeOf(searchStrategyFactory("x")).toEqualTypeOf<StringAnchorSearchStrategy>();
      expectTypeOf(
        searchStrategyFactory(["x"] as string | string[] | RegExp)
      ).toEqualTypeOf<RegexSearchStrategy | StringAnchorSearchStrategy>();
    });

    it("takes the backoff options only for a RegExp needle", () => {
      searchStrategyFactory(/x/, { minCandidateLengthToBackOff: 10 });
      // @ts-expect-error a backoff option does nothing for a string needle
      searchStrategyFactory("x", { minCandidateLengthToBackOff: 10 });
      // @ts-expect-error nor for a needle that may be a string
      searchStrategyFactory(/x/ as string | RegExp, { minCandidateLengthToBackOff: 10 });
    });
  });
});
