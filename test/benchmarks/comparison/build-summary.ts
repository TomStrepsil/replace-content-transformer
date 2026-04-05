import fs from "node:fs";
import path from "node:path";

type MaybeBenchmarkData = {
  layout?: Array<{
    name?: string | null;
  }>;
  benchmarks?: Array<{
    name?: string;
    alias?: string;
    group?: number;
    runs?: Array<{
      stats?: {
        avg?: number;
      };
    }>;
  }>;
  context?: {
    cpu?: {
      name?: string;
      freq?: number;
    };
    arch?: string;
    runtime?: string;
  };
};

type ComparisonRow = {
  benchmark: string;
  baseAvgNs: number;
  candidateAvgNs: number;
  baseHz: number;
  candidateHz: number;
  samples: {
    candidate: number;
    base: number;
  };
  deltaPct: number;
};

const [
  outDir,
  refALabel,
  refBLabel,
  refA,
  refASha,
  refB,
  refBSha,
  summaryJsonPath
] = process.argv.slice(2);

const requiredArgs = {
  outDir,
  refALabel,
  refBLabel,
  refA,
  refASha,
  refB,
  refBSha,
  summaryJsonPath
};

const missingArgs = Object.entries(requiredArgs)
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingArgs.length > 0) {
  process.stderr.write(
    "Usage: node --experimental-strip-types test/benchmarks/comparison/build-summary.ts <outDir> <refALabel> <refBLabel> <refA> <refASha> <refB> <refBSha> <summaryJsonPath>\n"
  );
  process.stderr.write(`Missing required args: ${missingArgs.join(", ")}\n`);
  process.exit(1);
}

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf8"));
const maybeRead = <T>(p: string): T | null => (fs.existsSync(p) ? readJson<T>(p) : null);
const hzFromAvgNs = (avgNs: number) => (avgNs > 0 ? 1_000_000_000 / avgNs : 0);
const SETUP_COST_GROUP_NAME = "Setup Cost (strategy + transformer creation)";

function summarizeDeltas(rows: Array<{ deltaPct: number }>) {
  if (!rows.length) {
    return { count: 0, avgDeltaPct: 0, medianDeltaPct: 0, betterCount: 0, worseCount: 0 };
  }
  const sorted = rows.map((r) => r.deltaPct).sort((a, b) => a - b);
  const avgDeltaPct = rows.reduce((s, r) => s + r.deltaPct, 0) / rows.length;
  const medianDeltaPct = sorted[Math.floor(sorted.length / 2)];
  const betterCount = rows.filter((r) => r.deltaPct > 0).length;
  const worseCount = rows.filter((r) => r.deltaPct < 0).length;
  return { count: rows.length, avgDeltaPct, medianDeltaPct, betterCount, worseCount };
}

function isSetupCostBenchmark(
  data: MaybeBenchmarkData,
  benchmark: NonNullable<MaybeBenchmarkData["benchmarks"]>[number]
) {
  const groupIndex = benchmark.group;
  if (typeof groupIndex !== "number") return false;
  const groupName = data.layout?.[groupIndex]?.name;
  return groupName === SETUP_COST_GROUP_NAME;
}

function aggregateByBenchmarkName(
  data: MaybeBenchmarkData,
  options: { includeSetupCost: boolean }
) {
  const map = new Map<string, { totalAvgNs: number; count: number }>();
  for (const b of data.benchmarks || []) {
    const isSetup = isSetupCostBenchmark(data, b);
    if (options.includeSetupCost !== isSetup) continue;

    const name = b.alias || b.name;
    if (!name || name.includes("Runtime:")) continue;
    const run = b.runs && b.runs[0];
    const avgNs = run && run.stats && run.stats.avg;
    if (!avgNs || avgNs <= 0) continue;

    let entry = map.get(name);
    if (!entry) {
      entry = { totalAvgNs: 0, count: 0 };
      map.set(name, entry);
    }
    entry.totalAvgNs += avgNs;
    entry.count += 1;
  }

  const averaged = new Map<string, { avgNs: number; hz: number; samples: number }>();
  for (const [name, { totalAvgNs, count }] of map.entries()) {
    if (!count) continue;
    const avgNs = totalAvgNs / count;
    if (avgNs <= 0) continue;
    averaged.set(name, { avgNs, hz: hzFromAvgNs(avgNs), samples: count });
  }
  return averaged;
}

function compareMitataBenchmarks(
  candidate: MaybeBenchmarkData,
  base: MaybeBenchmarkData,
  options: { includeSetupCost: boolean }
) {
  const candidateMap = aggregateByBenchmarkName(candidate, options);
  const baseMap = aggregateByBenchmarkName(base, options);

  const rows: ComparisonRow[] = [];
  for (const [name, candidateRow] of candidateMap.entries()) {
    const baseRow = baseMap.get(name);
    if (!baseRow || baseRow.hz <= 0) continue;
    const deltaPct = ((candidateRow.hz - baseRow.hz) / baseRow.hz) * 100;
    rows.push({
      benchmark: name,
      baseAvgNs: baseRow.avgNs,
      candidateAvgNs: candidateRow.avgNs,
      baseHz: baseRow.hz,
      candidateHz: candidateRow.hz,
      samples: {
        candidate: candidateRow.samples,
        base: baseRow.samples
      },
      deltaPct
    });
  }

  rows.sort((a, b) => b.deltaPct - a.deltaPct);
  return { summary: summarizeDeltas(rows), rows };
}

function compareRuntime(candidate: MaybeBenchmarkData, base: MaybeBenchmarkData) {
  return compareMitataBenchmarks(candidate, base, { includeSetupCost: false });
}

function extractSystemContext(data: MaybeBenchmarkData | null) {
  if (!data || !data.context) return null;
  const { cpu, arch, runtime } = data.context;
  return {
    cpu: cpu?.name || "unknown",
    freq: cpu?.freq || 0,
    arch: arch || "unknown",
    runtime: runtime || "unknown"
  };
}

const refAAlg = readJson<MaybeBenchmarkData>(path.join(outDir, `${refALabel}.algorithm.json`));
const refBAlg = readJson<MaybeBenchmarkData>(path.join(outDir, `${refBLabel}.algorithm.json`));

const runtimeKeys = ["node", "bun", "deno"];
const runtimeComparisons: Record<string, ReturnType<typeof compareRuntime>> = {};
for (const runtime of runtimeKeys) {
  const refAPath = path.join(outDir, `${refALabel}.runtime.${runtime}.json`);
  const refBPath = path.join(outDir, `${refBLabel}.runtime.${runtime}.json`);
  const a = maybeRead<MaybeBenchmarkData>(refAPath);
  const b = maybeRead<MaybeBenchmarkData>(refBPath);
  if (a && b) {
    runtimeComparisons[runtime] = compareRuntime(a, b);
  }
}

const algorithmScenarios = compareMitataBenchmarks(refAAlg, refBAlg, {
  includeSetupCost: false
});
const algorithmSetupCost = compareMitataBenchmarks(refAAlg, refBAlg, {
  includeSetupCost: true
});

const algorithm = {
  ...algorithmScenarios,
  setupCost: algorithmSetupCost
};

const systemContext = extractSystemContext(refAAlg);

const summary = {
  generatedAt: new Date().toISOString(),
  refA: { label: refALabel, ref: refA, sha: refASha },
  refB: { label: refBLabel, ref: refB, sha: refBSha },
  algorithm,
  runtimes: runtimeComparisons,
  system: systemContext
};

fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2));
console.log(`Wrote ${summaryJsonPath}`);
