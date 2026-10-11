import optionsValidation from "./options-validation.js";
import { DEFAULT_OPTIONS } from "./default-options.js";

const validate = (overrides: object) =>
  optionsValidation({ ...DEFAULT_OPTIONS, ...overrides });

describe("options validation", () => {
  it("should accept the defaults", () => {
    expect(() => validate({})).not.toThrow();
  });

  it.each([
    ["maxBufferLength", Number.NaN],
    ["maxBufferLength", -1],
    ["maxBufferLength", null],
    ["maxBufferLength", "100"],
    ["minCandidateLengthToBackOff", Number.NaN],
    ["minCandidateLengthToBackOff", -1],
    ["minCandidateLengthToBackOff", null],
    ["bufferGrowthFactorBetweenEvaluations", Number.NaN],
    ["bufferGrowthFactorBetweenEvaluations", 0.5],
    ["bufferGrowthFactorBetweenEvaluations", null]
  ])("should reject %s of %j", (option, value) => {
    expect(() => validate({ [option]: value })).toThrow(RangeError);
    expect(() => validate({ [option]: value })).toThrow(option);
  });

  it.each([
    [{ maxBufferLength: Infinity }],
    [{ maxBufferLength: 0 }],
    [{ minCandidateLengthToBackOff: 0 }],
    [{ minCandidateLengthToBackOff: Infinity }],
    [{ bufferGrowthFactorBetweenEvaluations: 1 }],
    [{ bufferGrowthFactorBetweenEvaluations: Infinity }]
  ])("should accept %j", (options) => {
    expect(() => validate(options)).not.toThrow();
  });
});
