#!/usr/bin/env -S node --experimental-strip-types

/**
 * Exports succinct harness comparison results for tracking over time
 *
 * Takes mitata's full JSON output and extracts only the essential metrics:
 * - Timestamp
 * - System context (runtime, CPU, etc.)
 * - Per-scenario summary: harness name, avg time, min, max, p75, p99
 * - Winner per scenario
 *
 * Usage:
 *   node --experimental-strip-types test/benchmarks/algorithm/comparison.bench.ts --json | \
 *   node --experimental-strip-types test/benchmarks/algorithm/export-results.ts > test/benchmarks/algorithm/results/comparison-YYYY-MM-DD.json
 */

import type { ReadStream } from "node:fs";

interface MitataStats {
  min: number;
  max: number;
  avg: number;
  p75: number;
  p99: number;
  samples?: number[];
  debug?: string;
  ticks?: number;
  kind?: string;
}

interface MitataRun {
  name: string;
  stats: MitataStats;
  error?: Error;
  args: Record<string, unknown>;
}

interface MitataBenchmark {
  alias: string;
  runs: MitataRun[];
  kind: string;
  args: unknown[];
  group: number;
  baseline: boolean;
  style: {
    highlight: string | false;
    compact: boolean;
  };
}

interface MitataContext {
  cpu: {
    name: string;
    freq: number;
  };
  arch: string;
  runtime: string;
  version?: string;
}

interface MitataLayout {
  name: string | null;
  types: string[];
}

interface MitataOutput {
  context: MitataContext;
  benchmarks: MitataBenchmark[];
  layout: MitataLayout[];
}

interface SuccinctRun {
  harness: string;
  avg: number;
  min: number;
  max: number;
  p75: number;
  p99: number;
}

interface SuccinctScenario {
  scenario: string;
  runs: SuccinctRun[];
  winner: string;
}

interface SuccinctResult {
  timestamp: string;
  context: {
    cpu: string;
    arch: string;
    runtime: string;
  };
  scenarios: SuccinctScenario[];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  const stdin = process.stdin as unknown as ReadStream;

  for await (const chunk of stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function extractSuccinctResults(mitataOutput: MitataOutput): SuccinctResult {
  const scenarios: SuccinctScenario[] = [];
  const scenarioGroups = new Map<number, MitataBenchmark[]>();

  for (const benchmark of mitataOutput.benchmarks) {
    const groupId = benchmark.group;
    if (!scenarioGroups.has(groupId)) {
      scenarioGroups.set(groupId, []);
    }
    scenarioGroups.get(groupId)!.push(benchmark);
  }

  const scenarioNames = new Map<number, string>();
  for (let i = 0; i < mitataOutput.layout.length; i++) {
    const item = mitataOutput.layout[i];
    if (item.name && item.types.includes("g")) {
      scenarioNames.set(i, item.name);
    }
  }

  for (const [groupId, benchmarks] of scenarioGroups) {
    if (benchmarks.length === 0) continue;

    const scenarioName = scenarioNames.get(groupId) || `Group ${groupId}`;
    const succinctRuns: SuccinctRun[] = [];

    for (const benchmark of benchmarks) {
      const harnessName =
        benchmark.alias || benchmark.runs[0]?.name || "Unknown";

      for (const run of benchmark.runs) {
        if (run.error) continue;

        succinctRuns.push({
          harness: harnessName,
          avg: run.stats.avg,
          min: run.stats.min,
          max: run.stats.max,
          p75: run.stats.p75,
          p99: run.stats.p99
        });
      }
    }

    if (succinctRuns.length === 0) continue;

    const winner = succinctRuns.reduce((best, current) =>
      current.avg < best.avg ? current : best
    ).harness;

    scenarios.push({
      scenario: scenarioName,
      runs: succinctRuns,
      winner
    });
  }

  return {
    timestamp: new Date().toISOString(),
    context: {
      cpu: mitataOutput.context.cpu.name,
      arch: mitataOutput.context.arch,
      runtime: `${mitataOutput.context.runtime}${
        mitataOutput.context.version ? " " + mitataOutput.context.version : ""
      }`
    },
    scenarios
  };
}

async function main() {
  try {
    const input = await readStdin();
    const mitataOutput: MitataOutput = JSON.parse(input);
    const succinct = extractSuccinctResults(mitataOutput);

    console.log(JSON.stringify(succinct, null, 2));
  } catch (error) {
    console.error("Error processing mitata output:", error);
    process.exit(1);
  }
}

main();
