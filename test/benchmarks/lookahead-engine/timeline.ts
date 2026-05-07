/**
 * Terminal Gantt-chart visualisation of a single run's replacement timeline.
 *
 * Each replacement is drawn as a horizontal bar spanning its start → end
 * on a shared virtual-time axis. Chunk-emitted events are marked as ▾
 * beneath the bars. The chart makes concurrency differences immediately
 * visible: serial subjects show stacked sequential bars; concurrent
 * subjects show overlapping parallel bars.
 *
 * Usage: called from printReport when the BENCH_TIMELINE env var is set,
 * or from run.sh with --timeline.
 */

import type { Subject } from "./subjects.ts";
import type { Measurement, TimelineEvent } from "./metrics.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Span {
  matchIndex: number;
  startT: number;
  endT: number;
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  green:   "\x1b[32m",
  magenta: "\x1b[35m",
  blue:    "\x1b[34m",
  red:     "\x1b[31m",
};

const BAR_COLORS = [C.cyan, C.green, C.yellow, C.magenta, C.blue];

function barColor(matchIndex: number): string {
  return BAR_COLORS[matchIndex % BAR_COLORS.length];
}

// ---------------------------------------------------------------------------
// Span extraction
// ---------------------------------------------------------------------------

function extractSpans(timeline: TimelineEvent[]): Span[] {
  const pending = new Map<number, number>(); // matchIndex → startT
  const spans: Span[] = [];

  for (const { t, event, meta } of timeline) {
    const matchIndex = meta?.matchIndex as number | undefined;
    if (matchIndex === undefined) continue;

    if (event === "replacement-start") {
      pending.set(matchIndex, t);
    } else if (event === "replacement-end") {
      const startT = pending.get(matchIndex);
      if (startT !== undefined) {
        spans.push({ matchIndex, startT, endT: t });
        pending.delete(matchIndex);
      }
    }
  }

  // Outer-match slots (Nested) never emit replacement-end; leave them as open
  // bars that extend to totalMs so they're at least visible.
  for (const [matchIndex, startT] of pending) {
    const done = timeline.find((e) => e.event === "done");
    spans.push({ matchIndex, startT, endT: done?.t ?? startT });
  }

  return spans.sort((a, b) => a.startT - b.startT || a.matchIndex - b.matchIndex);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CHART_WIDTH = 60;
const LABEL_WIDTH = 6; // "  99  " or " m 99 "

function renderBar(
  startT: number,
  endT: number,
  totalMs: number,
  chunkTs: number[],
  color: string
): string {
  const scale = (t: number) => Math.round((t / totalMs) * CHART_WIDTH);
  const start = scale(startT);
  const end = Math.max(start + 1, scale(endT));

  const bar: string[] = Array(CHART_WIDTH).fill("░");

  for (let i = start; i < end && i < CHART_WIDTH; i++) {
    bar[i] = "█";
  }

  // Mark chunk emissions that fall within this span's time window.
  for (const ct of chunkTs) {
    const pos = scale(ct);
    if (pos >= start && pos <= end && pos < CHART_WIDTH) {
      bar[pos] = "▾";
    }
  }

  return `▕${color}${bar.join("")}${C.reset}▏`;
}

function timeAxis(totalMs: number, unit: string): string {
  const ticks = [0, 0.25, 0.5, 0.75, 1.0];
  const positions = ticks.map((f) => Math.round(f * CHART_WIDTH));
  const labels = ticks.map((f) => `${Math.round(f * totalMs)} ${unit}`);

  // Build axis line
  const axis = Array(CHART_WIDTH + 2).fill("─");
  axis[0] = "╰";
  axis[CHART_WIDTH + 1] = "╯";
  for (const pos of positions) axis[pos + 1] = "┴";

  // Build label line — place labels centred under each tick position
  const labelLine = Array(CHART_WIDTH + 2).fill(" ");
  for (let i = 0; i < ticks.length; i++) {
    const pos = positions[i] + 1;
    const lbl = labels[i];
    const start = Math.max(0, pos - Math.floor(lbl.length / 2));
    for (let j = 0; j < lbl.length && start + j < labelLine.length; j++) {
      labelLine[start + j] = lbl[j];
    }
  }

  return (
    " ".repeat(LABEL_WIDTH) +
    C.dim + axis.join("") + C.reset + "\n" +
    " ".repeat(LABEL_WIDTH) +
    C.dim + labelLine.join("") + C.reset
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Print a Gantt-chart timeline for each subject's representative run
 * (the run closest to the median totalMs).
 *
 * @param scenario   Scenario name and description (for the header).
 * @param subjects   Ordered subject list.
 * @param blockResults  Full block results; one representative run is picked.
 */
export function printTimeline(
  scenarioName: string,
  subjects: Subject[],
  blockResults: Map<string, Measurement[]>
): void {
  const unit = "ms";

  console.log();
  console.log(`${C.bold}Timeline: ${scenarioName}${C.reset}  ${C.dim}(representative run per subject)${C.reset}`);

  for (const subject of subjects) {
    const measurements = blockResults.get(subject.id);
    if (!measurements?.length) continue;

    // Pick the run closest to the median totalMs.
    const sorted = [...measurements].sort((a, b) => a.totalMs - b.totalMs);
    const medIdx = Math.floor(sorted.length / 2);
    const rep = sorted[medIdx];

    const spans = extractSpans(rep.timeline);
    if (spans.length === 0) continue;

    const chunkTs = rep.timeline
      .filter((e) => e.event === "chunk-emitted")
      .map((e) => e.t);

    const totalMs = rep.totalMs;
    const labelPad = LABEL_WIDTH;

    console.log();
    console.log(
      `  ${C.bold}${subject.label}${C.reset}` +
      `  ${C.dim}${Math.round(totalMs)} ${unit}${C.reset}`
    );

    for (const span of spans) {
      const label = String(span.matchIndex).padStart(labelPad - 1).padEnd(labelPad);
      const bar = renderBar(span.startT, span.endT, totalMs, chunkTs, barColor(span.matchIndex));
      console.log(`  ${C.dim}${label}${C.reset}${bar}`);
    }

    console.log(timeAxis(totalMs, unit));
  }

  console.log();
}
