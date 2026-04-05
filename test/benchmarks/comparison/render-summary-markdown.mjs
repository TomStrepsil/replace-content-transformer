#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function usage() {
  process.stderr.write("Usage: node test/benchmarks/comparison/render-summary-markdown.mjs <summary.json> [output.md]\n");
}

const [summaryPath, outputPath] = process.argv.slice(2);
if (!summaryPath) {
  usage();
  process.exit(1);
}

const summaryAbs = path.resolve(summaryPath);
if (!fs.existsSync(summaryAbs)) {
  process.stderr.write(`Summary file not found: ${summaryAbs}\n`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryAbs, "utf8"));

const formatPct = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const noiseFloorPct = 2;

const signalLabel = (deltaPct) => {
  if (Math.abs(deltaPct) < noiseFloorPct) return "Within noise";
  return deltaPct > 0 ? "Likely faster" : "Likely slower";
};

const quantile = (sortedValues, q) => {
  if (!sortedValues.length) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * q))
  );
  return sortedValues[idx];
};

const summarizeRows = (rows) => {
  if (!rows.length) {
    return {
      count: 0,
      median: 0,
      p10: 0,
      p90: 0,
      better: 0,
      worse: 0,
      geoMeanDelta: 0
    };
  }

  const deltas = rows.map((row) => Number(row.deltaPct || 0)).sort((a, b) => a - b);
  const ratios = rows
    .filter((row) => Number(row.baseAvgNs) > 0 && Number(row.candidateAvgNs) > 0)
    .map((row) => Number(row.baseAvgNs) / Number(row.candidateAvgNs))
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0);

  const geoMeanRatio = ratios.length
    ? Math.exp(ratios.reduce((sum, ratio) => sum + Math.log(ratio), 0) / ratios.length)
    : 1;

  return {
    count: rows.length,
    median: quantile(deltas, 0.5),
    p10: quantile(deltas, 0.1),
    p90: quantile(deltas, 0.9),
    better: deltas.filter((d) => d > 0).length,
    worse: deltas.filter((d) => d < 0).length,
    geoMeanDelta: (geoMeanRatio - 1) * 100
  };
};

const algorithmRows = Array.isArray(summary.algorithm?.rows) ? summary.algorithm.rows : [];
const setupCostRows = Array.isArray(summary.algorithm?.setupCost?.rows)
  ? summary.algorithm.setupCost.rows
  : [];
const publicBenchmarkNames = new Set(["looped indexof anchored", "regex"]);
const isPublicBenchmark = (row) =>
  publicBenchmarkNames.has(String(row.benchmark || "").trim().toLowerCase());

const publicAlgorithmRows = algorithmRows.filter(isPublicBenchmark);
const benchmarkingAlgorithmRows = algorithmRows.filter((row) => !isPublicBenchmark(row));

const rowsToAlgorithmTable = (rows) =>
  rows
    .map((row) => {
      const name = String(row.benchmark || "(unknown)");
      const delta = Number(row.deltaPct || 0);
      return `| ${name} | ${formatPct(delta)} | ${signalLabel(delta)} |`;
    })
    .join("\n");

const rowsToSummaryTable = (name, rows) => {
  const s = summarizeRows(rows);
  return `| ${name} | ${s.count} | ${formatPct(s.geoMeanDelta)} | ${signalLabel(s.geoMeanDelta)} | ${formatPct(s.median)} | ${formatPct(s.p10)} .. ${formatPct(s.p90)} | ${s.better} | ${s.worse} |`;
};

const publicAlgorithmSummaryRows = [rowsToSummaryTable("public", publicAlgorithmRows)]
  .map((line) => line)
  .join("\n");

const benchmarkingAlgorithmSummaryRows = [rowsToSummaryTable("benchmarking", benchmarkingAlgorithmRows)]
  .map((line) => line)
  .join("\n");

const setupCostSummaryRows = [rowsToSummaryTable("setup-cost", setupCostRows)]
  .map((line) => line)
  .join("\n");

const runtimeRowsFixed = Object.entries(summary.runtimes || {})
  .map(([runtime, runtimeData]) => {
    const s = summarizeRows(Array.isArray(runtimeData.rows) ? runtimeData.rows : []);
    return `| ${runtime} | ${s.count} | ${formatPct(s.geoMeanDelta)} | ${signalLabel(s.geoMeanDelta)} | ${formatPct(s.median)} | ${formatPct(s.p10)} .. ${formatPct(s.p90)} | ${s.better} | ${s.worse} |`;
  })
  .join("\n");

const md = [
  "# Branch Benchmark Comparison",
  "",
  `- Ref A: ${summary.refA?.ref || "(unknown)"} (${summary.refA?.sha || "?"})`,
  `- Ref B: ${summary.refB?.ref || "(unknown)"} (${summary.refB?.sha || "?"})`,
  `- Generated: ${summary.generatedAt || "(unknown)"}`,
  "",
  "Ref A is compared against Ref B. Positive deltas mean Ref A is faster.",
  "Geomean speedup is the primary comparator (more robust than arithmetic mean of percent deltas).",
  `Signal labels use a ±${noiseFloorPct.toFixed(0)}% noise floor.`,
  "",
  "## Public Search Algorithms",
  "",
  "| Scope | Benchmarks | Geomean speedup | Signal | Median delta | P10..P90 delta | Better rows | Worse rows |",
  "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
  publicAlgorithmRows.length
    ? publicAlgorithmSummaryRows
    : "| public | 0 | +0.00% | Within noise | +0.00% | +0.00% .. +0.00% | 0 | 0 |",
  "",
  "| Algorithm | Delta | Signal |",
  "| --- | ---: | --- |",
  rowsToAlgorithmTable(publicAlgorithmRows) || "| (none) | +0.00% | Within noise |",
  "",
  "## Benchmarking Search Algorithms",
  "",
  "| Scope | Benchmarks | Geomean speedup | Signal | Median delta | P10..P90 delta | Better rows | Worse rows |",
  "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
  benchmarkingAlgorithmRows.length
    ? benchmarkingAlgorithmSummaryRows
    : "| benchmarking | 0 | +0.00% | Within noise | +0.00% | +0.00% .. +0.00% | 0 | 0 |",
  "",
  "| Algorithm | Delta | Signal |",
  "| --- | ---: | --- |",
  rowsToAlgorithmTable(benchmarkingAlgorithmRows) || "| (none) | +0.00% | Within noise |",
  "",
  "## Setup Cost (strategy + transformer creation)",
  "",
  "| Scope | Benchmarks | Geomean speedup | Signal | Median delta | P10..P90 delta | Better rows | Worse rows |",
  "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
  setupCostRows.length
    ? setupCostSummaryRows
    : "| setup-cost | 0 | +0.00% | Within noise | +0.00% | +0.00% .. +0.00% | 0 | 0 |",
  "",
  "| Harness | Delta | Signal |",
  "| --- | ---: | --- |",
  rowsToAlgorithmTable(setupCostRows) || "| (none) | +0.00% | Within noise |",
  "",
  "## Runtime Performance",
  "",
  "| Runtime | Benchmarks | Geomean speedup | Signal | Median delta | P10..P90 delta | Better rows | Worse rows |",
  "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
  runtimeRowsFixed || "| (none) | 0 | +0.00% | Within noise | +0.00% | +0.00% .. +0.00% | 0 | 0 |",
  ""
].join("\n");

if (outputPath) {
  fs.writeFileSync(path.resolve(outputPath), md);
} else {
  process.stdout.write(md);
}
