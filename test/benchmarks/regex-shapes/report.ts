/**
 * Deterministic companion to the timing run: what each shape costs in buffering,
 * and whether the streamed result still agrees with a non-streaming one.
 *
 * No timing, so this is stable enough to diff between branches directly.
 */

import { RegexSearchStrategy } from "../../../src/search-strategies/regex/search-strategy.ts";
import { chunksOf, shapes, scalingSizes, unbrokenContent } from "./shapes.ts";
import { drive, referenceMatchCount } from "./drive.ts";

const asJson = process.argv.includes("--json");

interface ShapeReport {
  shape: string;
  boundary: string;
  chunks: number;
  matches: number;
  flushMatches: number;
  referenceMatches: number;
  agreesWithReference: boolean;
  peakBuffer: number;
  peakBufferRatio: number;
  lossless: boolean;
}

const reports: ShapeReport[] = shapes.map((shape) => {
  const chunks = chunksOf(shape.content, shape.chunkSize);
  const result = drive(new RegexSearchStrategy(shape.pattern), chunks);
  const referenceMatches = referenceMatchCount(shape.pattern, shape.content);
  return {
    shape: shape.name,
    boundary: shape.boundary,
    chunks: chunks.length,
    matches: result.matches,
    flushMatches: result.flushMatches,
    referenceMatches,
    agreesWithReference:
      result.matches + result.flushMatches === referenceMatches,
    peakBuffer: result.peakBuffer,
    peakBufferRatio: result.peakBuffer / shape.content.length,
    lossless: result.output === shape.content
  };
});

const growth = scalingSizes.map((size) => {
  const content = unbrokenContent(size);
  const result = drive(new RegexSearchStrategy(/\S+/), chunksOf(content, 64));
  return { size, peakBuffer: result.peakBuffer, lossless: result.output === content };
});

if (asJson) {
  console.log(JSON.stringify({ shapes: reports, growth }, null, 2));
} else {
  const pad = (value: string | number, width: number) =>
    String(value).padStart(width);

  console.log("\nRegex shapes — buffering and fidelity (no timing)\n");
  console.log(
    `${"shape".padEnd(52)} ${"boundary".padEnd(15)} ${pad("chunks", 6)} ${pad("matches", 8)} ${pad("flush", 6)} ${pad("ref", 5)} ${pad("peak buf", 9)} ${pad("% held", 7)}`
  );
  for (const report of reports) {
    const flag = report.agreesWithReference && report.lossless ? "" : "  ⚠️";
    console.log(
      `${report.shape.slice(0, 52).padEnd(52)} ${report.boundary.padEnd(15)} ${pad(report.chunks, 6)} ${pad(report.matches, 8)} ${pad(report.flushMatches, 6)} ${pad(report.referenceMatches, 5)} ${pad(report.peakBuffer, 9)} ${pad((report.peakBufferRatio * 100).toFixed(1), 7)}${flag}`
    );
  }

  console.log("\nBuffer growth for a shape that never settles (/\\S+/, 64-byte chunks)\n");
  console.log(`${pad("input", 8)} ${pad("peak buffer", 12)}`);
  for (const row of growth) {
    console.log(`${pad(row.size, 8)} ${pad(row.peakBuffer, 12)}`);
  }

  const wrong = reports.filter((r) => !r.agreesWithReference || !r.lossless);
  console.log(
    wrong.length === 0
      ? "\n✅ every shape agrees with the non-streaming reference, and output is lossless\n"
      : `\n⚠️  ${wrong.length} shape(s) disagree with the non-streaming reference\n`
  );
}
