import { AsyncReplaceContentTransformer } from "../../../src/adapters/web/async-transformer.ts";
import { AsyncSerialReplacementTransformEngine } from "../../../src/engines/async-serial-transform-engine.ts";
import { AsyncLookaheadTransformEngine } from "../../../src/engines/async-lookahead-transform-engine/engine.ts";
import { SemaphoreStrategy } from "../../../src/engines/async-lookahead-transform-engine/concurrency-strategy/semaphore-strategy.ts";
import { PriorityQueueStrategy } from "../../../src/engines/async-lookahead-transform-engine/concurrency-strategy/priority-queue-strategy.ts";
import { streamOrder, breadthFirst } from "../../../src/engines/async-lookahead-transform-engine/concurrency-strategy/node-comparators.ts";
import { Nested } from "../../../src/engines/async-lookahead-transform-engine/nested.ts";
import type { ReplacementContext } from "../../../src/engines/types.ts";
import type { Scenario } from "./scenarios.ts";
import { computeMeasurement, type Measurement, type TimelineEvent } from "./metrics.ts";

// The engine's ReplacementFn admits Nested; alias used throughout.
type ReplacementFn = (
  match: string,
  context: ReplacementContext
) => Promise<AsyncIterable<string> | Nested>;

// ---------------------------------------------------------------------------
// Manual-nesting adapter (for AsyncReplaceContentTransformer / subject A)
//
// AsyncReplaceContentTransformer cannot consume a `Nested` result — it
// calls `yield* fn(match)` and expects an AsyncIterable<string>.
//
// This adapter wraps an instrumented ReplacementFn so that any `Nested`
// return value is transparently converted into a child
// AsyncReplaceContentTransformer pipeline (the README "Manage Recursion"
// pattern), making subject A a fair serial comparison for nested scenarios.
// ---------------------------------------------------------------------------

/**
 * Pipe an AsyncIterable<string> through a Transformer<string, string>
 * and return the result as an AsyncIterable<string>.
 *
 * Writing runs concurrently with reading; the TransformStream's internal
 * buffer provides backpressure.
 */
function pipeThrough(
  source: AsyncIterable<string>,
  transformer: Transformer<string, string>
): AsyncIterable<string> {
  const { writable, readable } = new TransformStream(transformer);
  const writer = writable.getWriter();
  void (async () => {
    try {
      for await (const chunk of source) await writer.write(chunk);
      await writer.close();
    } catch (err) {
      await writer.abort(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return (async function* () {
    yield* readable;
  })();
}

/**
 * Wrap an instrumented ReplacementFn for use with AsyncReplaceContentTransformer.
 *
 * When the inner function returns a `Nested`, this adapter creates a child
 * `AsyncReplaceContentTransformer` (using the scenario's search strategy) and
 * pipes the Nested source through it — exactly the README "Manage Recursion"
 * pattern. The adapter is self-referential so nesting works to any depth.
 */
function makeManualNestingAdapter(
  instrumented: ReplacementFn,
  createSearchStrategy: () => ReturnType<Scenario["createSearchStrategy"]>
): (match: string, context: ReplacementContext) => Promise<AsyncIterable<string>> {
  const adapted: (match: string, context: ReplacementContext) => Promise<AsyncIterable<string>> =
    async (match, context) => {
      const result = await instrumented(match, context);
      if (!(result instanceof Nested)) return result as AsyncIterable<string>;
      // Manual nesting: re-scan via a fresh child transformer (same strategy).
      const childTransformer = new AsyncReplaceContentTransformer(
        new AsyncSerialReplacementTransformEngine({
          searchStrategy: createSearchStrategy(),
          replacement: adapted
        })
      );
      return pipeThrough(result.source, childTransformer);
    };
  return adapted;
}

// ---------------------------------------------------------------------------
// Subject descriptor
// ---------------------------------------------------------------------------

export interface Subject {
  id: string;
  label: string;
  create: (
    scenario: Scenario,
    wrappedReplacement: ReplacementFn,
    concurrency: number
  ) => Transformer<string, string>;
}

export const subjects: Subject[] = [
  {
    id: "A",
    label: "Serial (A)",
    /**
     * Uses AsyncReplaceContentTransformer with a manual-nesting adapter so
     * that Nested return values are handled via recursive child transformers
     * (the README "Manage Recursion" pattern). On flat scenarios the adapter
     * is a zero-overhead pass-through.
     */
    create: (scenario, wrappedReplacement) => {
      const adapted = makeManualNestingAdapter(
        wrappedReplacement,
        scenario.createSearchStrategy
      );
      return new AsyncReplaceContentTransformer(
        new AsyncSerialReplacementTransformEngine({
          searchStrategy: scenario.createSearchStrategy(),
          replacement: adapted
        })
      );
    }
  },
  {
    id: "A_prime",
    label: "Lookahead serial c=1 (A')",
    create: (scenario, wrappedReplacement) =>
      new AsyncReplaceContentTransformer(
        new AsyncLookaheadTransformEngine({
          searchStrategy: scenario.createSearchStrategy(),
          concurrencyStrategy: new SemaphoreStrategy(1),
          replacement: wrappedReplacement
        })
      )
  },
  {
    id: "B",
    label: "Lookahead semaphore c=N (B)",
    create: (scenario, wrappedReplacement, concurrency) =>
      new AsyncReplaceContentTransformer(
        new AsyncLookaheadTransformEngine({
          searchStrategy: scenario.createSearchStrategy(),
          concurrencyStrategy: new SemaphoreStrategy(concurrency),
          replacement: wrappedReplacement
        })
      )
  },
  {
    id: "C",
    label: "Lookahead streamOrder c=N (C)",
    create: (scenario, wrappedReplacement, concurrency) =>
      new AsyncReplaceContentTransformer(
        new AsyncLookaheadTransformEngine({
          searchStrategy: scenario.createSearchStrategy(),
          concurrencyStrategy: new PriorityQueueStrategy(concurrency, streamOrder),
          replacement: wrappedReplacement
        })
      )
  },
  {
    id: "D",
    label: "Lookahead breadthFirst c=N (D)",
    create: (scenario, wrappedReplacement, concurrency) =>
      new AsyncReplaceContentTransformer(
        new AsyncLookaheadTransformEngine({
          searchStrategy: scenario.createSearchStrategy(),
          concurrencyStrategy: new PriorityQueueStrategy(concurrency, breadthFirst),
          replacement: wrappedReplacement
        })
      )
  }
];

// ---------------------------------------------------------------------------
// Instrumented replacement
//
// Wraps the scenario's replacement to record replacement-start / end events
// on the shared timeline. `getElapsed` reads `performance.now() - t0`, which
// works transparently with both real timers and Vitest fake timers (since
// vi.useFakeTimers can also fake `performance`).
//
// When the replacement returns a Nested sentinel, replacement-end is recorded
// immediately (after the outer delay). The inner work belongs to child slots
// and is tracked by their own start/end events.
// ---------------------------------------------------------------------------

function instrumentReplacement(
  original: ReplacementFn,
  timeline: TimelineEvent[],
  getElapsed: () => number
): ReplacementFn {
  return async (match: string, context: ReplacementContext) => {
    const { matchIndex } = context;
    timeline.push({ t: getElapsed(), event: "replacement-start", meta: { matchIndex } });

    const result = await original(match, context);

    if (result instanceof Nested) {
      timeline.push({ t: getElapsed(), event: "replacement-end", meta: { matchIndex } });
      return result;
    }

    return (async function* () {
      try {
        yield* result;
      } finally {
        timeline.push({ t: getElapsed(), event: "replacement-end", meta: { matchIndex } });
      }
    })();
  };
}

// ---------------------------------------------------------------------------
// Run harness
// ---------------------------------------------------------------------------

/**
 * Feed the scenario through the subject's TransformStream, recording a
 * timeline of events. Returns a `Measurement`.
 *
 * When called inside a `vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] })`
 * block (driven by `vi.runAllTimersAsync()`), timings reflect virtual ms and
 * wall-clock time is near-zero. With real timers, timings are wall-clock ms.
 */
export async function runSubject(
  subject: Subject,
  scenario: Scenario,
  concurrency: number
): Promise<Measurement> {
  const timeline: TimelineEvent[] = [];
  const chunkTimes: number[] = [];

  const t0 = performance.now();
  const getElapsed = () => performance.now() - t0;

  const scenarioReplacement: ReplacementFn = (match, context) =>
    scenario.replacement(match, context.matchIndex, context.streamIndices);
  const wrappedReplacement = instrumentReplacement(scenarioReplacement, timeline, getElapsed);

  const transformer = subject.create(scenario, wrappedReplacement, concurrency);
  const { writable, readable } = new TransformStream(transformer);
  const writer = writable.getWriter();

  const outputChunks: string[] = [];

  const readAll = async () => {
    for await (const value of readable) {
      chunkTimes.push(getElapsed());
      timeline.push({ t: chunkTimes[chunkTimes.length - 1], event: "chunk-emitted" });
      outputChunks.push(value);
    }
  };

  const chunkDelay = scenario.chunkDelayMs
    ? (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    : null;

  const writeAll = async () => {
    for (const chunk of scenario.inputChunks) {
      await writer.write(chunk);
      timeline.push({ t: getElapsed(), event: "write" });
      if (chunkDelay) await chunkDelay(scenario.chunkDelayMs!);
    }
    await writer.close();
  };

  await Promise.all([readAll(), writeAll()]);

  const totalMs = getElapsed();
  timeline.push({ t: totalMs, event: "done" });

  const actualOutput = outputChunks.join("");
  if (actualOutput !== scenario.expectedOutput) {
    throw new Error(
      `[${subject.id}] Output mismatch for scenario "${scenario.name}".\n` +
        `  Expected: ${JSON.stringify(scenario.expectedOutput.slice(0, 120))}\n` +
        `  Got:      ${JSON.stringify(actualOutput.slice(0, 120))}`
    );
  }

  return computeMeasurement(chunkTimes, totalMs, timeline);
}
