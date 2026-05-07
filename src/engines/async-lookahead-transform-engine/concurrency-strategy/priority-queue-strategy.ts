import type { ConcurrencyStrategy } from "./types.ts";
import type { IterableSlotNode } from "../slot-tree/types.ts";
import { MinHeap } from "./min-heap.ts";
import { streamOrder, type NodeComparator } from "./node-comparators.ts";

interface QueuedAcquire {
  readonly node: IterableSlotNode;
  readonly resolve: (release: () => void) => void;
}

/**
 * A {@link ConcurrencyStrategy} that grants slots in an order determined
 * by a {@link NodeComparator} over the slot tree, rather than FIFO
 * arrival order.
 *
 * When concurrency is saturated, newly queued acquires wait in a
 * min-heap keyed by the comparator. As slots free up, the
 * highest-priority (lowest comparator value) waiter is granted next.
 *
 * Defaults to {@link streamOrder} — earlier-in-output-stream content wins
 * — which is the natural choice when downstream consumers benefit from
 * the head of the stream arriving sooner. Pass {@link breadthFirst} for
 * level-by-level dispatch.
 */
export class PriorityQueueStrategy implements ConcurrencyStrategy {
  readonly #limit: number;
  readonly #heap: MinHeap<QueuedAcquire>;
  #active = 0;

  constructor(concurrency: number, comparator: NodeComparator = streamOrder) {
    if (concurrency < 1) {
      throw new RangeError(
        `PriorityQueueStrategy concurrency must be >= 1 (got ${concurrency})`
      );
    }
    this.#limit = concurrency;
    this.#heap = new MinHeap<QueuedAcquire>((a, b) => comparator(a.node, b.node));
  }

  acquire(node: IterableSlotNode): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      this.#heap.push({ node, resolve });
      this.#tryNext();
    });
  }

  #tryNext(): void {
    while (this.#active < this.#limit && this.#heap.size > 0) {
      const { resolve } = this.#heap.pop()!;
      this.#active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        this.#active--;
        this.#tryNext();
      });
    }
  }
}
