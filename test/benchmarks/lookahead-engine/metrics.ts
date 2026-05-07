import { percentile, stdDev } from "./utils.ts";

export type EventKind =
  | "write"
  | "replacement-start"
  | "replacement-end"
  | "chunk-emitted"
  | "done";

export interface TimelineEvent {
  /** Milliseconds since the start of the run (t0). */
  t: number;
  event: EventKind;
  meta?: Record<string, unknown>;
}

export interface GapStats {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** σ/μ of inter-chunk gaps. Higher = burstier output. */
  coefficientOfVariation: number;
}

export interface Measurement {
  totalMs: number;
  interChunkGaps: GapStats;
  /** Peak concurrent replacements in flight during this run. */
  maxInFlight: number;
  timeline: TimelineEvent[];
}

export function computeMeasurement(
  chunkTimes: number[],
  totalMs: number,
  timeline: TimelineEvent[]
): Measurement {
  const gapValues: number[] = [];
  for (let i = 1; i < chunkTimes.length; i++) {
    gapValues.push(chunkTimes[i] - chunkTimes[i - 1]);
  }
  const sortedGaps = [...gapValues].sort((a, b) => a - b);
  const gapMean =
    gapValues.length > 0
      ? gapValues.reduce((s, v) => s + v, 0) / gapValues.length
      : 0;

  const interChunkGaps: GapStats = {
    p50: percentile(sortedGaps, 50),
    p95: percentile(sortedGaps, 95),
    p99: percentile(sortedGaps, 99),
    max: sortedGaps.length > 0 ? sortedGaps[sortedGaps.length - 1] : 0,
    coefficientOfVariation:
      gapMean > 0 ? stdDev(gapValues, gapMean) / gapMean : 0
  };

  let currentInFlight = 0;
  let maxInFlight = 0;
  for (const { event } of timeline) {
    if (event === "replacement-start") {
      if (++currentInFlight > maxInFlight) maxInFlight = currentInFlight;
    } else if (event === "replacement-end") {
      currentInFlight--;
    }
  }

  return { totalMs, interChunkGaps, maxInFlight, timeline };
}
