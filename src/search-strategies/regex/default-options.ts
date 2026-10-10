export const DEFAULT_OPTIONS = {
  /**
   * Longest held-back span, in code units, before it is settled with the
   * original pattern as at end of stream and `onGuardExceeded` is called.
   * @default Infinity
   */
  maxBufferLength: Infinity,
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
