import type { StreamIndices, SearchStrategy } from "../../../src/search-strategies/types.ts";
import { StringAnchorSearchStrategy } from "../../../src/search-strategies/index.ts";
import { Nested } from "../../../src/lookahead/nested.ts";
import { mulberry32 } from "./utils.ts";

export type ReplacementFn = (
  match: string,
  matchIndex: number,
  streamIndices: StreamIndices
) => Promise<AsyncIterable<string> | Nested>;

export interface Scenario {
  name: string;
  description: string;
  /**
   * Input chunks fed one at a time (one write per entry). Splitting across
   * many chunks exercises each subject's ability to pipeline writes.
   */
  inputChunks: string[];
  /** Factory called once per run for a fresh, stateful search-strategy instance. */
  createSearchStrategy: () => SearchStrategy<unknown, string>;
  /**
   * Restrict which subjects run this scenario by their `id`. When omitted
   * all subjects run. Use this to exclude subjects that lack a required
   * capability (e.g. `Nested` support requires the lookahead engine).
   */
  subjectIds?: string[];
  /**
   * When set, `runSubject` inserts a virtual delay of this many ms between
   * each input chunk write. This simulates a truly streaming source (e.g. an
   * LLM token stream) where chunks arrive one at a time over real time, rather
   * than all being available upfront. Combined with `Nested` replacements, this
   * creates conditions where FIFO (B) and breadthFirst (D) diverge: children of
   * early outer matches can queue up before later outer chunks arrive, so FIFO
   * dispatches those children while breadthFirst still promotes the incoming
   * outer slot.
   */
  chunkDelayMs?: number;
  /**
   * Pin the concurrency dial for this scenario regardless of the global
   * `--concurrency` flag. Use when the B-vs-D divergence only manifests at a
   * specific concurrency level.
   */
  concurrencyOverride?: number;
  /**
   * The replacement function for this scenario. Latency may sit either:
   *
   * - Before the iterable is returned (`await delay(N)` inside the async
   *   function body) — models TTFB / request-initiation cost.
   * - Inside the returned generator (`await delay(N)` between yields) —
   *   models body-streaming cost (chunks arriving over time, e.g. an LLM
   *   token stream or a slow HTTP body).
   *
   * The slot is held across both phases (initiation + production), and
   * released only when the producer reaches `done: true`. Returning
   * `Nested` releases the slot at return time — see the engine's slot
   * lifetime docs.
   */
  replacement: ReplacementFn;
  expectedOutput: string;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Scenario 1: Uniform
//
// 20 matches, each replacement takes 50 ms.
//
// Expected outcomes:
//   A  (serial)              ≈ 20 × 50 ms = 1 000 ms total
//   A' (lookahead, c=1)      ≈ 1 000 ms   (serial dispatch; scanner runs ahead)
//   B  (semaphore, c=N)      ≈ ceil(20/N) × 50 ms
//   C/D (priority, c=N)      ≈ same as B on flat input (no nesting to order)
//
// With the default concurrency of 4: B/C/D ≈ 250 ms — a 4× win.
// ---------------------------------------------------------------------------

const UNIFORM_MATCH_COUNT = 20;
const UNIFORM_DELAY_MS = 50;

const uniformInputChunks: string[] = Array.from(
  { length: UNIFORM_MATCH_COUNT },
  (_, i) => `text-${i} {{match-${i}}} `
);

const uniformExpectedOutput: string = uniformInputChunks
  .map((_, i) => `text-${i} MATCH-${i} `)
  .join("");

export const uniformScenario: Scenario = {
  name: "Uniform",
  description: `${UNIFORM_MATCH_COUNT} matches × ${UNIFORM_DELAY_MS} ms uniform latency`,
  inputChunks: uniformInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  replacement: async (match) => {
    await delay(UNIFORM_DELAY_MS);
    const content = match.slice(2, -2).toUpperCase();
    return (async function* () { yield content; })();
  },
  expectedOutput: uniformExpectedOutput
};

// ---------------------------------------------------------------------------
// Scenario 2: Slow-head
//
// Match 0 takes 500 ms; matches 1-19 take 20 ms.
//
// Expected outcomes:
//   A  (serial)    ≈ 500 + 19 × 20 = 880 ms
//   A' (c=1)       ≈ 880 ms
//   B  (c=4)       ≈ 500 ms — slot 0 gates output; later slots finish early
//                              and drain immediately once the head resolves
//   C/D (c=4)      ≈ 500 ms — streamOrder cannot help when slot 0 is the
//                              critical path for all downstream output
// ---------------------------------------------------------------------------

const SLOW_HEAD_MATCH_COUNT = 20;
const SLOW_HEAD_SLOW_MS = 500;
const SLOW_HEAD_FAST_MS = 20;

const slowHeadInputChunks: string[] = Array.from(
  { length: SLOW_HEAD_MATCH_COUNT },
  (_, i) => `text-${i} {{match-${i}}} `
);

const slowHeadExpectedOutput: string = slowHeadInputChunks
  .map((_, i) => `text-${i} MATCH-${i} `)
  .join("");

export const slowHeadScenario: Scenario = {
  name: "Slow-head",
  description: `Match 0: ${SLOW_HEAD_SLOW_MS} ms; matches 1-${SLOW_HEAD_MATCH_COUNT - 1}: ${SLOW_HEAD_FAST_MS} ms`,
  inputChunks: slowHeadInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  replacement: async (match, matchIndex) => {
    await delay(matchIndex === 0 ? SLOW_HEAD_SLOW_MS : SLOW_HEAD_FAST_MS);
    const content = match.slice(2, -2).toUpperCase();
    return (async function* () { yield content; })();
  },
  expectedOutput: slowHeadExpectedOutput
};

// ---------------------------------------------------------------------------
// Scenario 3: Jittered
//
// 40 matches, latencies drawn from a log-normal distribution
// (median 40 ms, σ = 0.8 → p99 ≈ 400 ms), fixed PRNG seed for
// reproducibility across all subjects in the same run.
//
// Expected outcomes:
//   A  (serial)    high CV — each match has its own latency; no smoothing
//   B  (c=4)       lower CV — parallel dispatch absorbs tail latencies
// ---------------------------------------------------------------------------

const JITTERED_MATCH_COUNT = 40;
const JITTERED_SEED = 0xdeadbeef;

/** Log-normal sample: μ = ln(medianMs), σ in log space. Box-Muller. */
function logNormalSample(prng: () => number, medianMs: number, sigma: number): number {
  const u1 = Math.max(prng(), 1e-10);
  const u2 = prng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round(Math.exp(Math.log(medianMs) + sigma * z));
}

const jitteredLatencies: number[] = (() => {
  const prng = mulberry32(JITTERED_SEED);
  return Array.from({ length: JITTERED_MATCH_COUNT }, () =>
    Math.max(5, logNormalSample(prng, 40, 0.8))
  );
})();

const jitteredInputChunks: string[] = Array.from(
  { length: JITTERED_MATCH_COUNT },
  (_, i) => `text-${i} {{match-${i}}} `
);

const jitteredExpectedOutput: string = jitteredInputChunks
  .map((_, i) => `text-${i} MATCH-${i} `)
  .join("");

export const jitteredScenario: Scenario = {
  name: "Jittered",
  description: `${JITTERED_MATCH_COUNT} matches, log-normal latency (median 40 ms, σ=0.8, seed=0x${JITTERED_SEED.toString(16)})`,
  inputChunks: jitteredInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  replacement: async (match, matchIndex) => {
    await delay(jitteredLatencies[matchIndex] ?? 40);
    const content = match.slice(2, -2).toUpperCase();
    return (async function* () { yield content; })();
  },
  expectedOutput: jitteredExpectedOutput
};

// ---------------------------------------------------------------------------
// Scenario 4: Nested-wide
//
// 8 outer matches (100 ms each), each re-scanning via `Nested` to reveal
// 4 inner matches (50 ms each).
//
// The outer delay is intentionally equal to the inner delay so that when
// the first batch of outer slots (0-3) completes at t=100 ms, the remaining
// outer slots (4-7) are still queued and competing with the newly-created
// inner slots. This forces a prioritisation decision:
//
//   A    (serial)    ≈ 8 × (100 + 4×50) = 2 400 ms — depth-first: section N's
//                      inner work runs immediately after its outer resolves,
//                      so output flows section-by-section (maxGap ≈ 150 ms)
//   A'   (c=1)       ≈ 2 400 ms — scanner pre-queues all 8 outer slots before
//                      any replacement completes, so all outers run first
//                      (t=0–800 ms) and inner work only begins after; output
//                      is silent until t≈800 ms (maxGap ≈ 850 ms)
//   B  (FIFO, c=4)   ≈ outer-0..3 (100 ms) + outer-4..7 (100 ms)
//                      + 32 inner (8 batches × 50 ms = 400 ms) = 600 ms
//   D  (breadthFirst)≈ identical to B — the lookahead scanner queues all
//                      outer slots before inner slots exist, so FIFO and
//                      breadthFirst make the same choices here
//   C  (streamOrder) ≈ 600 ms total — same work, different order
//                      inner-0-0..3 outrank outer-4..7 in stream order, so
//                      section 0's inner work starts immediately at t=100 ms,
//                      but outer-4..7 stall until t=300 ms, producing a
//                      ~150 ms output gap mid-stream (visible in --timeline
//                      and reflected in maxGap)
// ---------------------------------------------------------------------------

const NESTED_OUTER_COUNT = 8;
const NESTED_INNER_PER_OUTER = 4;
const NESTED_OUTER_DELAY_MS = 100;
const NESTED_INNER_DELAY_MS = 50;

const nestedInputChunks: string[] = Array.from(
  { length: NESTED_OUTER_COUNT },
  (_, i) => `section-${i} {{outer:${i}}} `
);

// Expected: each outer slot becomes 4 uppercased inner tokens joined by space.
const nestedExpectedOutput: string = nestedInputChunks
  .map((_, oi) =>
    `section-${oi} ` +
    Array.from({ length: NESTED_INNER_PER_OUTER }, (__, ii) => `INNER:${oi}-${ii}`).join(" ") +
    " "
  )
  .join("");

export const nestedWideScenario: Scenario = {
  name: "Nested-wide",
  description:
    `${NESTED_OUTER_COUNT} outer × ${NESTED_INNER_PER_OUTER} inner matches; ` +
    `outer=${NESTED_OUTER_DELAY_MS} ms, inner=${NESTED_INNER_DELAY_MS} ms — ` +
    `C prioritises inner over pending outer siblings (higher maxGap mid-stream)`,
  inputChunks: nestedInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  replacement: async (match) => {
    if (match.startsWith("{{outer:")) {
      const id = match.slice(8, -2); // "0" … "7"
      await delay(NESTED_OUTER_DELAY_MS);
      const innerContent = Array.from(
        { length: NESTED_INNER_PER_OUTER },
        (_, ii) => `{{inner:${id}-${ii}}}`
      ).join(" ");
      return new Nested((async function* () { yield innerContent; })());
    }
    // Inner match: {{inner:X-Y}} → "INNER:X-Y"
    await delay(NESTED_INNER_DELAY_MS);
    const label = match.slice(2, -2).toUpperCase(); // strip {{ and }}
    return (async function* () { yield label; })();
  },
  expectedOutput: nestedExpectedOutput
};

// ---------------------------------------------------------------------------
// Scenario 5: Nested-streaming
//
// Demonstrates the condition under which B (FIFO) and D (breadthFirst)
// diverge in *output pacing*: a truly streaming input where outer matches
// arrive one chunk at a time, and early outer replacements complete fast
// enough to create inner children *before* later outer chunks have been
// written.
//
// When that happens, FIFO (B) dispatches the waiting inner children first
// (they arrived in the semaphore queue before the later outer slot). BreadthFirst
// (D) promotes the incoming outer slot over the waiting children because it is
// shallower (depth 0 < depth 1), keeping the outer pipeline moving.
//
// Both strategies process the same total compute, so totalMs is identical.
// The difference is output pacing (maxGap): B stalls the outer pipeline for
// one full inner-task batch before dispatching the next outer, creating larger
// gaps between sections. D pre-computes inner tokens while later sections are
// still being scanned, so those tokens are ready the moment output unblocks —
// smaller maxGap.
//
// Parameters are chosen so the divergence is forced:
//   outerDelay (20 ms) < chunkDelay (30 ms)
//     → outer-i completes and queues children before outer-i+1 is written
//   innerPerOuter (6) > concurrency (3)
//     → 3 children wait in queue behind the queued outer slot (in B's FIFO
//       order they arrived before the outer; D promotes the outer by depth)
//
// Expected outcomes (concurrencyOverride = 3):
//   B: FIFO picks 3 waiting inner children over the arriving outer slot →
//      outer pipeline stalls by one inner-task batch (80 ms) at each collision
//      → larger maxGap
//   D: breadthFirst picks outer slot (depth=0) over inner children (depth=1) →
//      outer pipeline drains quickly, inner tokens accumulate and flush without
//      stalls → smaller maxGap
// ---------------------------------------------------------------------------

const STREAMING_OUTER_COUNT = 8;
const STREAMING_INNER_PER_OUTER = 6;
const STREAMING_OUTER_DELAY_MS = 20;
const STREAMING_INNER_DELAY_MS = 80;
const STREAMING_CHUNK_DELAY_MS = 30;
const STREAMING_CONCURRENCY = 3;

const streamingInputChunks: string[] = Array.from(
  { length: STREAMING_OUTER_COUNT },
  (_, i) => `section-${i} {{outer:${i}}} `
);

const streamingExpectedOutput: string = streamingInputChunks
  .map((_, oi) =>
    `section-${oi} ` +
    Array.from({ length: STREAMING_INNER_PER_OUTER }, (__, ii) => `INNER:${oi}-${ii}`).join(" ") +
    " "
  )
  .join("");

export const nestedStreamingScenario: Scenario = {
  name: "Nested-streaming",
  description:
    `${STREAMING_OUTER_COUNT} outer (${STREAMING_OUTER_DELAY_MS} ms) × ` +
    `${STREAMING_INNER_PER_OUTER} inner (${STREAMING_INNER_DELAY_MS} ms); ` +
    `chunks arrive every ${STREAMING_CHUNK_DELAY_MS} ms — ` +
    `B/D identical totalMs; D reduces maxGap by keeping outer pipeline moving`,
  inputChunks: streamingInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  chunkDelayMs: STREAMING_CHUNK_DELAY_MS,
  concurrencyOverride: STREAMING_CONCURRENCY,
  subjectIds: ["B", "D"],
  replacement: async (match) => {
    if (match.startsWith("{{outer:")) {
      const id = match.slice(8, -2);
      await delay(STREAMING_OUTER_DELAY_MS);
      const innerContent = Array.from(
        { length: STREAMING_INNER_PER_OUTER },
        (_, ii) => `{{inner:${id}-${ii}}}`
      ).join(" ");
      return new Nested((async function* () { yield innerContent; })());
    }
    await delay(STREAMING_INNER_DELAY_MS);
    const label = match.slice(2, -2).toUpperCase();
    return (async function* () { yield label; })();
  },
  expectedOutput: streamingExpectedOutput
};

// ---------------------------------------------------------------------------
// Streaming-body variants
//
// Each variant mirrors a base scenario but moves most of the per-match
// latency from `await delay(...)` (TTFB) into the generator body
// (per-chunk awaits). Total per-match latency is unchanged; only the
// shape of the slot's occupancy changes.
//
// What this exercises:
//   - The slot is held across the *entire* in-flight lifetime — from
//     before `await fn()` until the producer pulls the last chunk.
//   - In TTFB-bound scenarios the producer drains in zero virtual time,
//     so slot-held duration ≈ TTFB. Streaming-body variants stretch
//     slot occupancy across body emission, exercising the new
//     "in-flight, not just initiation" semantics.
//
// What stays the same:
//   - totalMs and maxGap are unchanged — the in-order drainer pulls one
//     body at a time, so wall-clock work and pacing are dominated by
//     drain serialisation rather than slot accounting.
//   - The `maxInFlight` metric (now surfaced in the report) confirms
//     the bound — it should never exceed the configured concurrency in
//     these variants.
// ---------------------------------------------------------------------------

const TTFB_FRACTION = 0.1;
const BODY_CHUNKS = 5;

/**
 * Build a streaming-body iterable:
 * - Pre-iterable `await delay(ttfbMs)` for the initiation phase.
 * - Returned generator emits `parts` chunks (the joined `content`
 *   split into roughly equal pieces, padded with empty strings if
 *   needed) with `bodyMs / parts` between each.
 */
async function streamingBody(
  ttfbMs: number,
  bodyMs: number,
  content: string,
  parts: number
): Promise<AsyncIterable<string>> {
  await delay(ttfbMs);
  const pieceLen = Math.max(1, Math.ceil(content.length / parts));
  const pieces: string[] = [];
  for (let i = 0; i < content.length; i += pieceLen) {
    pieces.push(content.slice(i, i + pieceLen));
  }
  while (pieces.length < parts) pieces.push("");
  const perChunkMs = bodyMs / parts;
  return (async function* () {
    for (const piece of pieces) {
      await delay(perChunkMs);
      yield piece;
    }
  })();
}

export const uniformBodyScenario: Scenario = {
  name: "Uniform-body",
  description:
    `${UNIFORM_MATCH_COUNT} matches × ${UNIFORM_DELAY_MS} ms — ` +
    `TTFB ${UNIFORM_DELAY_MS * TTFB_FRACTION} ms + body ${UNIFORM_DELAY_MS * (1 - TTFB_FRACTION)} ms (${BODY_CHUNKS} chunks)`,
  inputChunks: uniformInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  replacement: async (match) => {
    const content = match.slice(2, -2).toUpperCase();
    return streamingBody(
      UNIFORM_DELAY_MS * TTFB_FRACTION,
      UNIFORM_DELAY_MS * (1 - TTFB_FRACTION),
      content,
      BODY_CHUNKS
    );
  },
  expectedOutput: uniformExpectedOutput
};

export const slowHeadBodyScenario: Scenario = {
  name: "Slow-head-body",
  description:
    `Match 0: ${SLOW_HEAD_SLOW_MS} ms; matches 1-${SLOW_HEAD_MATCH_COUNT - 1}: ${SLOW_HEAD_FAST_MS} ms — ` +
    `streaming-body variant (TTFB+body, ${BODY_CHUNKS} chunks)`,
  inputChunks: slowHeadInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  replacement: async (match, matchIndex) => {
    const total = matchIndex === 0 ? SLOW_HEAD_SLOW_MS : SLOW_HEAD_FAST_MS;
    const content = match.slice(2, -2).toUpperCase();
    return streamingBody(
      total * TTFB_FRACTION,
      total * (1 - TTFB_FRACTION),
      content,
      BODY_CHUNKS
    );
  },
  expectedOutput: slowHeadExpectedOutput
};

export const jitteredBodyScenario: Scenario = {
  name: "Jittered-body",
  description:
    `${JITTERED_MATCH_COUNT} matches, log-normal latency (median 40 ms) — ` +
    `streaming-body variant (TTFB+body, ${BODY_CHUNKS} chunks)`,
  inputChunks: jitteredInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  replacement: async (match, matchIndex) => {
    const total = jitteredLatencies[matchIndex] ?? 40;
    const content = match.slice(2, -2).toUpperCase();
    return streamingBody(
      total * TTFB_FRACTION,
      total * (1 - TTFB_FRACTION),
      content,
      BODY_CHUNKS
    );
  },
  expectedOutput: jitteredExpectedOutput
};

// Nested-wide-body: outer returns Nested (slot released at handoff, so
// streaming the outer body is moot). Stream the inner replacements'
// bodies instead — each inner's chunks emit over time, exercising the
// child engine's slot accounting.
export const nestedWideBodyScenario: Scenario = {
  name: "Nested-wide-body",
  description:
    `${NESTED_OUTER_COUNT} outer × ${NESTED_INNER_PER_OUTER} inner; ` +
    `outer=${NESTED_OUTER_DELAY_MS} ms (TTFB only), ` +
    `inner=${NESTED_INNER_DELAY_MS} ms (streaming body, ${BODY_CHUNKS} chunks)`,
  inputChunks: nestedInputChunks,
  createSearchStrategy: () => new StringAnchorSearchStrategy(["{{", "}}"]),
  replacement: async (match) => {
    if (match.startsWith("{{outer:")) {
      const id = match.slice(8, -2);
      await delay(NESTED_OUTER_DELAY_MS);
      const innerContent = Array.from(
        { length: NESTED_INNER_PER_OUTER },
        (_, ii) => `{{inner:${id}-${ii}}}`
      ).join(" ");
      return new Nested((async function* () { yield innerContent; })());
    }
    const label = match.slice(2, -2).toUpperCase();
    return streamingBody(
      NESTED_INNER_DELAY_MS * TTFB_FRACTION,
      NESTED_INNER_DELAY_MS * (1 - TTFB_FRACTION),
      label,
      BODY_CHUNKS
    );
  },
  expectedOutput: nestedExpectedOutput
};

// ---------------------------------------------------------------------------
// All scenarios exported for use by run harnesses
// ---------------------------------------------------------------------------

export const allScenarios: Scenario[] = [
  uniformScenario,
  uniformBodyScenario,
  slowHeadScenario,
  slowHeadBodyScenario,
  jitteredScenario,
  jitteredBodyScenario,
  nestedWideScenario,
  nestedWideBodyScenario,
  nestedStreamingScenario
];
