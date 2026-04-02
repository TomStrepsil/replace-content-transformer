#!/usr/bin/env bash

set -euo pipefail

# Compare benchmark results for current checkout against BASE_REF.
# BASE_REF can be a branch name or a commit hash.
#
# Usage examples:
#   ./test/benchmarks/compare-branches.sh
#   BASE_REF=main ./test/benchmarks/compare-branches.sh
#   BASE_REF=<main_commit_hash> ./test/benchmarks/compare-branches.sh
#
# Optional env vars:
#   CANDIDATE_LABEL (default: current branch name)
#   BASE_LABEL      (default: BASE_REF)
#   OUTPUT_DIR      (default: test/benchmarks/results/branch-comparisons/<timestamp>)

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CANDIDATE_REF="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
BASE_REF="${BASE_REF:-main}"
CANDIDATE_LABEL="${CANDIDATE_LABEL:-$CANDIDATE_REF}"
BASE_LABEL="${BASE_LABEL:-$BASE_REF}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/test/benchmarks/results/branch-comparisons/$TIMESTAMP}"

mkdir -p "$OUTPUT_DIR"

echo "Candidate: $CANDIDATE_REF"
echo "Base:      $BASE_REF"
echo "Output:    $OUTPUT_DIR"

WORKTREE_DIR="$(mktemp -d "$ROOT_DIR/.tmp-bench-base-XXXXXX")"
cleanup() {
  git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$ROOT_DIR" worktree add --detach "$WORKTREE_DIR" "$BASE_REF" >/dev/null

run_benchmarks() {
  local repo_dir="$1"
  local label="$2"
  local algo_out="$OUTPUT_DIR/${label}-algorithm.json"
  local runtime_out="$OUTPUT_DIR/${label}-runtime-node.json"

  echo "Running algorithm benchmark for $label"
  (
    cd "$repo_dir/test/benchmarks"
    ./algorithm/run-succinct.sh "$algo_out"
  )

  echo "Running runtime benchmark (Node JSON) for $label"
  (
    cd "$repo_dir/test/benchmarks"
    node --experimental-strip-types runtime/benchmarks.ts --json > "$runtime_out"
  )
}

run_benchmarks "$ROOT_DIR" "$CANDIDATE_LABEL"
run_benchmarks "$WORKTREE_DIR" "$BASE_LABEL"

SUMMARY_JSON="$OUTPUT_DIR/summary.json"

node - "$OUTPUT_DIR" "$CANDIDATE_LABEL" "$BASE_LABEL" "$CANDIDATE_REF" "$BASE_REF" "$SUMMARY_JSON" <<'NODE'
const fs = require("fs");
const path = require("path");

const [outDir, candidateLabel, baseLabel, candidateRef, baseRef, summaryPath] = process.argv.slice(2);

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const candidateAlgo = readJson(path.join(outDir, `${candidateLabel}-algorithm.json`));
const baseAlgo = readJson(path.join(outDir, `${baseLabel}-algorithm.json`));
const candidateRuntime = readJson(path.join(outDir, `${candidateLabel}-runtime-node.json`));
const baseRuntime = readJson(path.join(outDir, `${baseLabel}-runtime-node.json`));

function normalizeAlgorithm(json) {
  const map = new Map();
  for (const scenario of json.scenarios || []) {
    for (const run of scenario.runs || []) {
      const key = `${scenario.scenario}::${run.harness}`;
      map.set(key, {
        scenario: scenario.scenario,
        harness: run.harness,
        avg: run.avg
      });
    }
  }
  return map;
}

function normalizeRuntime(json) {
  const map = new Map();
  for (const b of json.benchmarks || []) {
    const name = b.alias || b.name;
    if (!name || name.includes("Runtime:")) continue;
    const run = b.runs && b.runs[0];
    const avgNs = run && run.stats && run.stats.avg;
    if (!avgNs || avgNs <= 0) continue;
    const hz = 1_000_000_000 / avgNs;
    map.set(name, { name, avgNs, hz });
  }
  return map;
}

function compareMaps(base, candidate, keyLabel) {
  const rows = [];
  for (const [key, b] of base.entries()) {
    const c = candidate.get(key);
    if (!c) continue;
    const pct = ((c.avg - b.avg) / b.avg) * 100;
    rows.push({
      key,
      [keyLabel]: key,
      baseAvg: b.avg,
      candidateAvg: c.avg,
      deltaPct: pct
    });
  }
  rows.sort((a, b) => b.deltaPct - a.deltaPct);
  const avgDeltaPct = rows.length
    ? rows.reduce((s, r) => s + r.deltaPct, 0) / rows.length
    : 0;
  return { rows, avgDeltaPct, count: rows.length };
}

const algoBase = normalizeAlgorithm(baseAlgo);
const algoCandidate = normalizeAlgorithm(candidateAlgo);
const algoRows = [];
for (const [key, b] of algoBase.entries()) {
  const c = algoCandidate.get(key);
  if (!c) continue;
  algoRows.push({
    scenario: b.scenario,
    harness: b.harness,
    baseAvg: b.avg,
    candidateAvg: c.avg,
    deltaPct: ((c.avg - b.avg) / b.avg) * 100
  });
}
algoRows.sort((a, b) => b.deltaPct - a.deltaPct);
const algoAvgDelta = algoRows.length
  ? algoRows.reduce((s, r) => s + r.deltaPct, 0) / algoRows.length
  : 0;

const runtimeBase = normalizeRuntime(baseRuntime);
const runtimeCandidate = normalizeRuntime(candidateRuntime);
const runtimeRows = [];
for (const [name, b] of runtimeBase.entries()) {
  const c = runtimeCandidate.get(name);
  if (!c) continue;
  runtimeRows.push({
    benchmark: name,
    baseHz: b.hz,
    candidateHz: c.hz,
    deltaPct: ((c.hz - b.hz) / b.hz) * 100
  });
}
runtimeRows.sort((a, b) => a.deltaPct - b.deltaPct);
const runtimeAvgDelta = runtimeRows.length
  ? runtimeRows.reduce((s, r) => s + r.deltaPct, 0) / runtimeRows.length
  : 0;

const summary = {
  generatedAt: new Date().toISOString(),
  candidate: { ref: candidateRef, label: candidateLabel },
  base: { ref: baseRef, label: baseLabel },
  files: {
    candidateAlgorithm: `${candidateLabel}-algorithm.json`,
    baseAlgorithm: `${baseLabel}-algorithm.json`,
    candidateRuntimeNode: `${candidateLabel}-runtime-node.json`,
    baseRuntimeNode: `${baseLabel}-runtime-node.json`
  },
  algorithm: {
    comparedRows: algoRows.length,
    avgDeltaPct: algoAvgDelta,
    rows: algoRows
  },
  runtimeNode: {
    comparedRows: runtimeRows.length,
    avgDeltaPct: runtimeAvgDelta,
    rows: runtimeRows
  }
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`Wrote ${summaryPath}`);
NODE

echo
echo "Comparison complete"
echo "Summary: $SUMMARY_JSON"
