/**
 * Timing run for the regex search strategy across content shapes.
 *
 * Grouped by what each shape forces at a chunk boundary, so a regression shows
 * up against shapes that share its behaviour rather than against an average
 * over unrelated ones. The `buffers-to-end` group is reported as a growth curve
 * because its cost rises with stream length rather than as a constant factor.
 *
 * Usage:
 *   node --import tsx regex-shapes/run.bench.ts
 *   node --import tsx regex-shapes/run.bench.ts --json > results.json
 */

import { bench, group, run } from "mitata";
import { RegexSearchStrategy } from "../../../src/search-strategies/regex/search-strategy.ts";
import {
  chunksOf,
  scalingSizes,
  shapes,
  unbrokenContent,
  type BoundaryBehaviour
} from "./shapes.ts";
import { drive } from "./drive.ts";

const groupTitles: Record<BoundaryBehaviour, string> = {
  settles: "Settles at the boundary (no deferral)",
  defers: "Defers to the next chunk (bounded buffering)",
  "buffers-to-end": "Buffers to end of stream (unbounded)",
  "no-match": "No match anywhere (cheapest path)"
};

const order: BoundaryBehaviour[] = [
  "settles",
  "defers",
  "buffers-to-end",
  "no-match"
];

for (const boundary of order) {
  const inGroup = shapes.filter((shape) => shape.boundary === boundary);
  if (inGroup.length === 0) continue;

  group(groupTitles[boundary], () => {
    for (const shape of inGroup) {
      const strategy = new RegexSearchStrategy(shape.pattern);
      const chunks = chunksOf(shape.content, shape.chunkSize);
      bench(shape.name, () => drive(strategy, chunks));
    }
  });
}

group("Growth curve — /\\S+/ over unbroken text, 64-byte chunks", () => {
  for (const size of scalingSizes) {
    const strategy = new RegexSearchStrategy(/\S+/);
    const chunks = chunksOf(unbrokenContent(size), 64);
    bench(`${size} chars (${chunks.length} chunks)`, () => drive(strategy, chunks));
  }
});

await run(process.argv.includes("--json") ? { format: "json" } : {});
