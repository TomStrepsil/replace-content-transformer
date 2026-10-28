import optionsValidation from "./options-validation.js";
import { DEFAULT_OPTIONS } from "./default-options.js";

const validate = (overrides: object) =>
  optionsValidation({ ...DEFAULT_OPTIONS, ...overrides });

describe("options validation", () => {
  it("should accept the defaults", () => {
    expect(() => validate({})).not.toThrow();
  });

  it.each([
    ["minCandidateLengthToBackOff", Number.NaN, RangeError],
    ["minCandidateLengthToBackOff", -1, RangeError],
    ["minCandidateLengthToBackOff", null, TypeError],
    ["bufferGrowthFactorBetweenEvaluations", Number.NaN, RangeError],
    ["bufferGrowthFactorBetweenEvaluations", 0.5, RangeError],
    ["bufferGrowthFactorBetweenEvaluations", null, TypeError]
  ])("should reject %s of %j with a %O", (option, value, error) => {
    expect(() => validate({ [option]: value })).toThrow(error);
    expect(() => validate({ [option]: value })).toThrow(option);
  });

  it.each([
    [{ minCandidateLengthToBackOff: 0 }],
    [{ minCandidateLengthToBackOff: Infinity }],
    [{ bufferGrowthFactorBetweenEvaluations: 1 }],
    [{ bufferGrowthFactorBetweenEvaluations: Infinity }]
  ])("should accept %j", (options) => {
    expect(() => validate(options)).not.toThrow();
  });
});
