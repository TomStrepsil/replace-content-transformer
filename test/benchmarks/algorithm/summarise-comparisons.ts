import type { Comparison } from "./comparisons.ts";

/** What mitata's `run()` returns, including the `layout` and `group` its typings omit. */
export interface BenchResults {
  benchmarks: {
    alias: string;
    group: number;
    runs: { stats?: { avg: number } }[];
  }[];
  layout: { name: string | null }[];
}

const keyOf = (scenario: string, harness: string) => `${scenario}\u0000${harness}`;

const geometricMean = (values: number[]) =>
  Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);

const relative = (ratio: number) =>
  ratio >= 1 ? `${ratio.toFixed(2)}x slower` : `${(1 / ratio).toFixed(2)}x faster`;

/**
 * Each compared harness's average time relative to its comparison's baseline: the geometric
 * mean of the per-scenario ratios, and their range.
 */
export function summariseComparisons(
  comparisons: Comparison[],
  results: BenchResults,
  scenarios: string[]
): string {
  const averages = new Map<string, number>();
  for (const { alias, group, runs } of results.benchmarks) {
    const scenario = results.layout[group]?.name;
    const average = runs[0]?.stats?.avg;
    if (scenario && average !== undefined) averages.set(keyOf(scenario, alias), average);
  }

  const lines = ["", "Comparisons (time relative to baseline, geometric mean over scenarios)"];
  for (const { name, question, baseline, compared } of comparisons) {
    lines.push("", `${name}: ${question}`, `  ${"baseline".padEnd(14)}  ${baseline.name}`);
    for (const harness of compared) {
      const ratios = scenarios.flatMap((scenario) => {
        const baselineAverage = averages.get(keyOf(scenario, baseline.name));
        const harnessAverage = averages.get(keyOf(scenario, harness.name));
        return baselineAverage && harnessAverage ? [harnessAverage / baselineAverage] : [];
      });
      if (ratios.length === 0) continue;
      lines.push(
        `  ${relative(geometricMean(ratios)).padEnd(14)}  ${harness.name}` +
          ` (${relative(Math.min(...ratios))} to ${relative(Math.max(...ratios))}, ${ratios.length} scenarios)`
      );
    }
  }
  return lines.join("\n");
}
