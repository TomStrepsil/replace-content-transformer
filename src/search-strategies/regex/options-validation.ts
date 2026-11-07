import type { DEFAULT_OPTIONS } from "./default-options.js";
import { validateAtLeast } from "../buffer-guard.js";

const MINIMUMS: Record<keyof typeof DEFAULT_OPTIONS, number> = {
  minCandidateLengthToBackOff: 0,
  bufferGrowthFactorBetweenEvaluations: 1
};

const optionsValidation = (options: typeof DEFAULT_OPTIONS) => {
  for (const [name, minimum] of Object.entries(MINIMUMS)) {
    validateAtLeast(name, options[name as keyof typeof DEFAULT_OPTIONS], minimum);
  }
};

export default optionsValidation;
