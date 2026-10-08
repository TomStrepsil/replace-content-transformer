/**
 * Exhaustive chunk-boundary enumeration, for asserting that a stream's matches
 * do not depend on where it happened to be split.
 */

/** Every possible two-way split of `haystack`, plus the unsplit input. */
function everyTwoWaySplit(haystack: string): string[][] {
  const splits: string[][] = [[haystack]];
  for (let i = 1; i < haystack.length; i++) {
    splits.push([haystack.slice(0, i), haystack.slice(i)]);
  }
  return splits;
}

/** Every possible three-way split of `haystack` into three non-empty parts. */
function everyThreeWaySplit(haystack: string): string[][] {
  const splits: string[][] = [];
  for (let first = 1; first < haystack.length; first++) {
    for (let second = first + 1; second < haystack.length; second++) {
      splits.push([
        haystack.slice(0, first),
        haystack.slice(first, second),
        haystack.slice(second)
      ]);
    }
  }
  return splits;
}

/** The input as single-character chunks — the most adversarial split possible. */
function characterBySplit(haystack: string): string[] {
  return [...haystack];
}

export { characterBySplit, everyThreeWaySplit, everyTwoWaySplit };
