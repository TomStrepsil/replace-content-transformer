import type { DEFAULT_OPTIONS } from "./default-options.js";

const MINIMUMS: Record<keyof typeof DEFAULT_OPTIONS, number> = {
  maxBufferLength: 0,
  minCandidateLengthToBackOff: 0,
  bufferGrowthFactorBetweenEvaluations: 1
};

const optionsValidation = (options: typeof DEFAULT_OPTIONS) => {
  for (const [name, minimum] of Object.entries(MINIMUMS)) {
    const value: unknown = options[name as keyof typeof DEFAULT_OPTIONS];
    if (typeof value !== "number" || !(value >= minimum)) {
      throw new RangeError(
        `${name} must be a number of at least ${minimum} (or Infinity), received ${String(value)}`
      );
    }
  }
};

export default optionsValidation;
