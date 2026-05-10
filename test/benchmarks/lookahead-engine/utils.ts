/**
 * Mulberry32 — fast, seedable 32-bit PRNG.
 * Returns a function that produces floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

/** Fisher-Yates in-place shuffle using a supplied PRNG. */
export function shuffle<T>(arr: T[], prng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** p-th percentile of a pre-sorted array (0–100). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Sample median. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}


/** Sample standard deviation. */
export function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Non-parametric 95% bootstrap confidence interval for the median.
 * Uses 1 000 resamples by default.
 */
export function bootstrapMedianCI(
  values: number[],
  iterations = 1000,
  seed = 0
): { lower: number; upper: number } {
  if (values.length === 0) return { lower: 0, upper: 0 };
  const prng = mulberry32(seed);
  const n = values.length;
  const medians: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample = Array.from({ length: n }, () => values[Math.floor(prng() * n)]);
    medians.push(median(sample));
  }
  medians.sort((a, b) => a - b);
  return {
    lower: percentile(medians, 2.5),
    upper: percentile(medians, 97.5)
  };
}
