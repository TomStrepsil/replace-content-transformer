import type { ConcurrencyStrategy } from "./types.ts";
import type { IterableSlotNode } from "../slot-tree/types.ts";
import { Semaphore } from "./semaphore.ts";

/**
 * The default {@link ConcurrencyStrategy}.
 *
 * Caps simultaneous **in-flight** replacement iterables (initiation +
 * production) with a counting semaphore. Waiters are released in FIFO
 * order — i.e. scan order — so priority across recursive levels is
 * determined entirely by arrival time at `acquire()`.
 *
 * Sufficient for most use cases. Use {@link PriorityQueueStrategy} only
 * when cross-level prioritisation (e.g. earlier-in-stream slots
 * pre-empting later same-level siblings) is required.
 */
export class SemaphoreStrategy implements ConcurrencyStrategy {
  readonly #semaphore: Semaphore;

  constructor(concurrency: number) {
    if (concurrency < 1) {
      throw new RangeError(`SemaphoreStrategy concurrency must be >= 1 (got ${concurrency})`);
    }
    this.#semaphore = new Semaphore(concurrency);
  }

  async acquire(_node: IterableSlotNode): Promise<() => void> {
    void _node;
    await this.#semaphore.acquire();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#semaphore.release();
    };
  }
}
