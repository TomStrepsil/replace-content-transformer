import type { SlotNode } from "./types.ts";

/**
 * A bounded single-producer / single-consumer async channel of
 * {@link SlotNode}s.
 *
 * - `push()` suspends when the queue is at `limit`; resolves immediately
 *   if a consumer is already waiting (direct hand-off).
 * - `close()` signals end-of-stream; any waiting consumer is resolved
 *   with `{ done: true }`.
 * - Iteration yields nodes in push order and terminates after `close()`
 *   once the buffered nodes are drained.
 *
 * Backpressure for the lookahead transformer is implemented by the
 * `push()` suspension: when the scanner runs ahead of the drainer, the
 * queue fills and the scanner's next push awaits a consumer pull.
 */
export class AsyncChildQueue implements AsyncIterable<SlotNode> {
  readonly #limit: number;
  readonly #buffer: SlotNode[] = [];
  readonly #pendingProducers: Array<() => void> = [];
  readonly #pendingConsumers: Array<(result: IteratorResult<SlotNode>) => void> = [];
  #closed = false;

  constructor(limit: number) {
    if (limit < 1) {
      throw new RangeError(`AsyncChildQueue limit must be >= 1 (got ${limit})`);
    }
    this.#limit = limit;
  }

  async push(node: SlotNode): Promise<void> {
    if (this.#closed) {
      throw new Error("Cannot push to a closed AsyncChildQueue");
    }
    const waitingConsumer = this.#pendingConsumers.shift();
    if (waitingConsumer) {
      waitingConsumer({ value: node, done: false });
      return;
    }
    if (this.#buffer.length >= this.#limit) {
      await new Promise<void>((resolve) => this.#pendingProducers.push(resolve));
    }
    this.#buffer.push(node);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    while (this.#pendingConsumers.length > 0) {
      this.#pendingConsumers.shift()!({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SlotNode, void, undefined> {
    while (true) {
      if (this.#buffer.length > 0) {
        const node = this.#buffer.shift()!;
        // Wake a waiting producer — capacity has freed up
        this.#pendingProducers.shift()?.();
        yield node;
        continue;
      }
      if (this.#closed) {
        return;
      }
      const next = await new Promise<IteratorResult<SlotNode>>((resolve) =>
        this.#pendingConsumers.push(resolve)
      );
      if (next.done) return;
      yield next.value;
    }
  }
}
