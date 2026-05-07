import { median, bootstrapMedianCI } from "./utils.ts";
import type { Measurement } from "./metrics.ts";
import type { Subject } from "./subjects.ts";
import type { Scenario } from "./scenarios.ts";

// ---------------------------------------------------------------------------
// Terminal table
// ---------------------------------------------------------------------------

const COLS = {
  label: 30,
  total: 10,
  maxGap: 9,
  cv: 8,
  inFlight: 9
};

function pad(s: string, width: number, right = false): string {
  const str = String(s);
  const padded = right ? str.padStart(width) : str.padEnd(width);
  return padded.length > width ? padded.slice(0, width) : padded;
}

function fms(n: number): string {
  return `${Math.round(n)} ms`;
}

function fmt2(n: number): string {
  return n.toFixed(2);
}

function ruler(char: string, width: number): string {
  return char.repeat(width);
}

const TOTAL_WIDTH =
  COLS.label + COLS.total + COLS.maxGap + COLS.cv + COLS.inFlight;

function headerRow(): string {
  return (
    pad("Subject", COLS.label) +
    pad("total", COLS.total, true) +
    pad("maxGap", COLS.maxGap, true) +
    pad("CV", COLS.cv, true) +
    pad("inFlight", COLS.inFlight, true)
  );
}

function dataRow(label: string, measurements: Measurement[]): string {
  const totals = measurements.map((m) => m.totalMs);
  const maxGaps = measurements.map((m) => m.interChunkGaps.max);
  const cvs = measurements.map((m) => m.interChunkGaps.coefficientOfVariation);
  const inFlights = measurements.map((m) => m.maxInFlight);

  return (
    pad(label, COLS.label) +
    pad(fms(median(totals)), COLS.total, true) +
    pad(fms(median(maxGaps)), COLS.maxGap, true) +
    pad(fmt2(median(cvs)), COLS.cv, true) +
    pad(String(Math.round(median(inFlights))), COLS.inFlight, true)
  );
}

// Within-block ratios vs subject A for drift-corrected comparison.
function withinBlockRatios(
  blockResults: Map<string, Measurement[]>,
  baselineId: string,
  subjectIds: string[]
): Map<string, number[]> {
  const baseline = blockResults.get(baselineId)!;
  const ratiosMap = new Map<string, number[]>();
  for (const id of subjectIds) {
    if (id === baselineId) continue;
    const measurements = blockResults.get(id)!;
    const ratios = measurements.map((m, i) => m.totalMs / (baseline[i]?.totalMs ?? 1));
    ratiosMap.set(id, ratios);
  }
  return ratiosMap;
}

export function printReport(
  scenario: Scenario,
  subjects: Subject[],
  blockResults: Map<string, Measurement[]>,
  concurrency: number,
  blocks: number
): void {
  const divider = ruler("═", TOTAL_WIDTH);
  const thinDiv = ruler("─", TOTAL_WIDTH);

  console.log();
  console.log(divider);
  console.log(
    `Scenario: ${scenario.name}  ` +
      `(${scenario.description}, concurrency=${concurrency}, ${blocks} blocks)`
  );
  console.log(divider);
  console.log(headerRow());
  console.log(thinDiv);

  for (const s of subjects) {
    const measurements = blockResults.get(s.id);
    if (!measurements?.length) continue;
    console.log(dataRow(s.label, measurements));
  }

  console.log(divider);

  const subjectIds = subjects.map((s) => s.id);
  const baselineId = subjectIds[0];
  const ratiosMap = withinBlockRatios(blockResults, baselineId, subjectIds);

  if (ratiosMap.size > 0) {
    const baselineLabel = subjects.find((s) => s.id === baselineId)?.label ?? baselineId;
    console.log(
      `Drift-corrected ratios vs ${baselineLabel} (within-block, 95% bootstrap CI on median ratio):`
    );
    for (const s of subjects) {
      if (s.id === baselineId) continue;
      const ratios = ratiosMap.get(s.id);
      if (!ratios?.length) continue;
      const med = median(ratios);
      const ci = bootstrapMedianCI(ratios);
      const label = s.label.padEnd(COLS.label);
      console.log(
        `  ${label}  ${med.toFixed(3)}  [${ci.lower.toFixed(3)}–${ci.upper.toFixed(3)}]`
      );
    }
    console.log(divider);
  }
}
