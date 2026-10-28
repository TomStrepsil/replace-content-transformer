import { BalancedPairRegexSearchStrategy } from "./search-strategy.ts";
import { BalancedPairSearchStrategy } from "../../balanced-pair/search-strategy.ts";
import { collectSearchStrategyResults } from "../../../../test/utilities.ts";
import { everySplitOf } from "../../../../test/splits.ts";

describe("BalancedPairRegexSearchStrategy", () => {
  it.each([
    ["(", ")", "a((b) c)d(e"],
    ["{{", "}}", "x{{a{{b}}}}y{{c}"],
    ["**", "*", "**a**"]
  ])(
    "matches as BalancedPairSearchStrategy does, at every split, with %s and %s",
    (opening, closing, input) => {
      for (const chunks of everySplitOf(input)) {
        expect(
          collectSearchStrategyResults(
            new BalancedPairRegexSearchStrategy(opening, closing),
            chunks
          ),
          chunks.join("|")
        ).toEqual(
          collectSearchStrategyResults(
            new BalancedPairSearchStrategy(opening, closing),
            chunks
          )
        );
      }
    }
  );

  it("finds delimiters with a RegExp rather than indexOf", () => {
    const strategy = new BalancedPairRegexSearchStrategy("(", ")");
    const exec = vi.spyOn(RegExp.prototype, "exec");
    try {
      collectSearchStrategyResults(strategy, ["a(b)c"]);
      expect(exec.mock.contexts.map((pattern) => (pattern as RegExp).source)).toEqual(
        expect.arrayContaining(["\\(", "\\)"])
      );
    } finally {
      exec.mockRestore();
    }
  });
});
