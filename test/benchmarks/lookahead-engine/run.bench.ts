/**
 * Virtual-clock strategy benchmark suite driven by Vitest fake timers.
 *
 * Each subject run wraps `runSubject` with `vi.useFakeTimers` so that
 * `setTimeout` and `performance.now` are intercepted. `vi.runAllTimersAsync`
 * drives all pending (and chained) timers to completion while allowing
 * microtask chains to settle between ticks — preserving the concurrency
 * semantics that make the benchmark meaningful (semaphore slots are held for
 * the full virtual delay) while keeping wall-clock time near-zero.
 *
 * Configure via env vars:
 *   BENCH_CONCURRENCY=4 BENCH_SCENARIO=Uniform npx vitest run strategy/run.virtual.bench.ts
 */

import { describe, test, vi, afterEach } from "vitest";
import { allScenarios } from "./scenarios.ts";
import { subjects, runSubject } from "./subjects.ts";
import { runBlockDesign, type BlockSubject } from "./block-design.ts";
import { printReport } from "./report.ts";
import { printTimeline } from "./timeline.ts";
import type { Measurement } from "./metrics.ts";

const showTimeline = !!process.env.BENCH_TIMELINE;

const blocks = 30;
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 4);
const seed = Number(process.env.BENCH_SEED ?? 42);
const scenarioFilter = process.env.BENCH_SCENARIO;

const scenariosToRun = scenarioFilter
  ? allScenarios.filter((s) => s.name.toLowerCase().includes(scenarioFilter.toLowerCase()))
  : allScenarios;

console.log(`\nStrategy benchmark — ${blocks} blocks, concurrency=${concurrency}`);

afterEach(() => {
  vi.useRealTimers();
});

describe("Strategy benchmarks", () => {
  for (const scenario of scenariosToRun) {
    test(scenario.name, { timeout: 120_000 }, async () => {
      console.log(`\n⏳  Running scenario: ${scenario.name} (${scenario.description})`);
      console.log(`    Warming up (3 passes per subject)…`);

      const scenarioSubjects = scenario.subjectIds
        ? subjects.filter((s) => scenario.subjectIds!.includes(s.id))
        : subjects;

      const effectiveConcurrency = scenario.concurrencyOverride ?? concurrency;

      const blockSubjects: BlockSubject<Measurement>[] = scenarioSubjects.map((s) => ({
        id: s.id,
        run: async (): Promise<Measurement> => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"], now: 0 });
          try {
            const promise = runSubject(s, scenario, effectiveConcurrency);
            await vi.runAllTimersAsync();
            return await promise;
          } finally {
            vi.useRealTimers();
          }
        }
      }));

      let completedBlocks = 0;

      const blockResults = await runBlockDesign<Measurement>({
        subjects: blockSubjects,
        blocks,
        seed,
        warmupRuns: 3,
        onProgress: (block, total) => {
          completedBlocks = block + 1;
          const pct = Math.round(((block + 1) / total) * 100);
          process.stdout.write(`\r    Block ${block + 1}/${total} (${pct}%)  `);
        }
      });

      process.stdout.write("\r" + " ".repeat(40) + "\r");

      printReport(scenario, scenarioSubjects, blockResults, effectiveConcurrency, completedBlocks);
      if (showTimeline) {
        printTimeline(scenario.name, scenarioSubjects, blockResults);
      }
    });
  }
});
