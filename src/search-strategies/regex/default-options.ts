export const DEFAULT_OPTIONS = {
  /**
   * Candidate length, in code units, from which re-scans are throttled by
   * `bufferGrowthFactorBetweenEvaluations`.
   * @default 1024
   */
  minCandidateLengthToBackOff: 1024,
  /**
   * Factor by which the buffer must grow since the last scan before a long
   * candidate is re-scanned.
   * @default 2
   */
  bufferGrowthFactorBetweenEvaluations: 2
};
