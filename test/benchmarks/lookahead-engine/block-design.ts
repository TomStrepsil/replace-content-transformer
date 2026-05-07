import { mulberry32, shuffle } from "./utils.ts";

/**
 * A subject in the block design. Owns its own `run()` so the harness
 * stays generic — callers bind scenario + concurrency before handing
 * the subject in.
 */
export interface BlockSubject<T> {
  id: string;
  run: () => Promise<T>;
}

export interface BlockDesignOptions<T> {
  subjects: BlockSubject<T>[];
  /** Total number of blocks (each subject measured once per block). @default 30 */
  blocks?: number;
  /** PRNG seed for the per-block shuffle. @default 42 */
  seed?: number;
  /** Untimed warm-up passes per subject before block 0. @default 3 */
  warmupRuns?: number;
  /** Called after each block completes with 0-based block index and total. */
  onProgress?: (block: number, total: number) => void;
}

/**
 * Randomized Complete Block Design harness.
 *
 * Each block is one pass through all subjects in a fresh randomised
 * order. Running multiple blocks and taking within-block ratios cancels
 * hardware drift (thermal throttling, background processes) that would
 * otherwise become a systematic bias in a simple serial run.
 *
 * Returns a `Map<subjectId, T[]>` where each array has exactly `blocks`
 * entries in block order.
 */
export async function runBlockDesign<T>(
  options: BlockDesignOptions<T>
): Promise<Map<string, T[]>> {
  const {
    subjects,
    blocks = 30,
    seed = 42,
    warmupRuns = 3,
    onProgress
  } = options;

  const prng = mulberry32(seed);
  const results = new Map<string, T[]>();
  for (const s of subjects) results.set(s.id, []);

  // Warm-up: untimed passes to stabilise JIT inlining
  for (let pass = 0; pass < warmupRuns; pass++) {
    for (const s of subjects) {
      await s.run();
    }
  }

  for (let block = 0; block < blocks; block++) {
    const order = shuffle([...subjects], prng);
    for (const s of order) {
      // Optional GC between runs (requires --expose-gc).
      (globalThis as unknown as { gc?: () => void }).gc?.();
      // Let the event loop quiesce between runs.
      await new Promise<void>((resolve) => setImmediate(resolve));
      results.get(s.id)!.push(await s.run());
    }
    onProgress?.(block, blocks);
  }

  return results;
}
