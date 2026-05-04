import type {
  SearchStrategy,
  StreamIndices
} from "../search-strategies/types.ts";
import type { ReplacementCallbackArgs } from "../replacement-processors/replacement-callback-types.ts";
import type { ConcurrencyStrategy } from "./concurrency-strategy/types.ts";
import type { IterableSlotNode, SlotNode } from "./slot-tree/types.ts";
import { AsyncChildQueue } from "./slot-tree/async-child-queue.ts";
import { Nested } from "./nested.ts";
import { SLOT_KIND } from "./slot-tree/constants.ts";

/**
 * Default backpressure limit on the internal slot queue. Scanning
 * suspends when this many slots are buffered ahead of the drain loop.
 * Tuned as a compromise between burst throughput and memory usage;
 * override via {@link LookaheadAsyncIterableTransformerOptions.highWaterMark}.
 */
export const DEFAULT_HIGH_WATER_MARK = 32;

/**
 * Wrap a replacement's `AsyncIterable<string>` so that the granted
 * concurrency slot is held through chunk production and released
 * exactly once when the producer reaches `done: true` (or throws, or
 * the consumer aborts the iterator early via `return()`).
 */
async function* slotHoldingIterable(
  source: AsyncIterable<string>,
  release: () => void
): AsyncGenerator<string> {
  try {
    yield* source;
  } finally {
    release();
  }
}

/**
 * Async function called for each match to produce its replacement content.
 *
 * Return a plain `AsyncIterable<string>` to emit the replacement chunks
 * verbatim, or a {@link Nested} (via the `nested()` helper) to opt in to
 * recursive re-scanning of the replacement content by a child engine
 * that shares this engine's configuration.
 */
export type ReplacementFn<TMatch> = (
  ...args: ReplacementCallbackArgs<TMatch>
) => Promise<AsyncIterable<string> | Nested>;

export interface LookaheadAsyncIterableTransformerOptions<TState, TMatch> {
  /** Search strategy used to locate matches in the input stream. */
  searchStrategy: SearchStrategy<TState, TMatch>;
  /** Function invoked for every match; result is streamed in place of the match. */
  replacement: ReplacementFn<TMatch>;
  /**
   * Pluggable strategy controlling when and in what order replacement
   * work is initiated. See {@link SemaphoreStrategy} (simple FIFO) and
   * {@link PriorityQueueStrategy} (tree-aware prioritisation).
   */
  concurrencyStrategy: ConcurrencyStrategy;
  /**
   * Maximum number of buffered slots in the internal queue before
   * scanning suspends. Provides backpressure when the drain loop
   * (downstream emission) lags behind the scanner.
   *
   * @default 32
   */
  highWaterMark?: number;
}

/**
 * Output sink for the engine. The hosting adapter supplies one of these
 * to translate engine emissions into its native push primitive (e.g.
 * `TransformStreamDefaultController.enqueue` for WHATWG, `push()` for
 * `stream.Transform`). `error` is called at most once with the first
 * failure observed by the engine; after `error`, no further `enqueue`
 * calls are made.
 */
export interface LookaheadSink {
  enqueue(chunk: string): void;
  error(err: unknown): void;
}

/**
 * Stream-protocol-agnostic core of the lookahead transformer.
 *
 * Owns the scan → schedule → drain pipeline: input chunks are fed via
 * {@link write}; the scanner produces text + iterable slots, pushes them
 * onto a bounded queue, and schedules replacement work through the
 * injected {@link ConcurrencyStrategy}. A concurrent drain loop
 * (started by {@link start}) dequeues slots in stream order and emits
 * chunks through the supplied {@link LookaheadSink}.
 *
 * Adapter classes (`LookaheadAsyncIterableTransformer` in web,
 * `LookaheadAsyncIterableTransform` in node) wrap this engine, mapping
 * their runtime's transform lifecycle onto `start`/`write`/`end`.
 *
 * Nested re-scanning (returned via the `nested()` sentinel) is handled
 * internally by spawning a child engine and bridging its sink into the
 * outer drain loop — adapters need not plumb nesting themselves.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type
 */
export class LookaheadEngine<TState, TMatch> {
  readonly #options: LookaheadAsyncIterableTransformerOptions<TState, TMatch>;
  readonly #sink: LookaheadSink;
  readonly #parent: IterableSlotNode | null;
  readonly #queue: AsyncChildQueue;
  readonly #state: TState;

  #matchIndex = 0;
  #siblingIndex = 0;
  #drainDone: Promise<void> | null = null;

  constructor(
    options: LookaheadAsyncIterableTransformerOptions<TState, TMatch>,
    sink: LookaheadSink,
    /**
     * @internal Set by the outer engine when spawning a child to re-scan
     * a {@link Nested} replacement. Not part of the public adapter API.
     */
    parent: IterableSlotNode | null = null
  ) {
    this.#options = options;
    this.#sink = sink;
    this.#parent = parent;
    this.#queue = new AsyncChildQueue(
      options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK
    );
    this.#state = options.searchStrategy.createState();
  }

  /** Start the drain loop. Must be called once before {@link write}. */
  start(): void {
    this.#drainDone = this.#drain().catch((err) => {
      this.#sink.error(err);
      // Re-throw so end() surfaces the failure too.
      throw err;
    });
  }

  /**
   * Feed one input chunk into the scanner. Suspends when the internal
   * queue is full (backpressure).
   */
  async write(chunk: string): Promise<void> {
    for (const result of this.#options.searchStrategy.processChunk(
      chunk,
      this.#state
    )) {
      if (!result.isMatch) {
        await this.#queue.push({
          kind: SLOT_KIND.text,
          siblingIndex: this.#siblingIndex++,
          value: result.content
        });
        continue;
      }
      await this.#queue.push(
        this.#scheduleMatch(result.content, result.streamIndices)
      );
    }
  }

  /**
   * Signal end-of-input. Emits any trailing content held by the search
   * strategy, closes the queue, and waits for the drain loop to finish.
   * Rejects with the first error raised by the drain loop or by any
   * scheduled replacement, so adapters can forward failures.
   */
  async end(): Promise<void> {
    const tail = this.#options.searchStrategy.flush(this.#state);
    if (tail.length > 0) {
      await this.#queue.push({
        kind: SLOT_KIND.text,
        siblingIndex: this.#siblingIndex++,
        value: tail
      });
    }
    this.#queue.close();
    await this.#drainDone;
  }

  #scheduleMatch(
    match: TMatch,
    streamIndices: StreamIndices
  ): IterableSlotNode {
    const matchIndex = this.#matchIndex++;
    const node: IterableSlotNode = {
      kind: SLOT_KIND.iterable,
      siblingIndex: this.#siblingIndex++,
      parent: this.#parent,
      iterable: undefined as unknown as Promise<AsyncIterable<string> | Nested>
    };
    node.iterable = this.#runSlot(node, match, matchIndex, streamIndices);
    return node;
  }

  async #runSlot(
    node: IterableSlotNode,
    match: TMatch,
    matchIndex: number,
    streamIndices: StreamIndices
  ): Promise<AsyncIterable<string> | Nested> {
    const release = await this.#options.concurrencyStrategy.acquire(node);
    let result: AsyncIterable<string> | Nested;
    try {
      result = await this.#options.replacement(match, matchIndex, streamIndices);
    } catch (err) {
      release();
      throw err;
    }
    if (result instanceof Nested) {
      // Handoff: parent's "part" is done. Each match found while
      // re-scanning the nested body acquires its own slot via the
      // child engine — the parent's slot is freed immediately.
      release();
      return result;
    }
    return slotHoldingIterable(result, release);
  }

  async #drain(): Promise<void> {
    for await (const slot of this.#queue) {
      await this.#emitSlot(slot);
    }
  }

  async #emitSlot(slot: SlotNode): Promise<void> {
    if (slot.kind === SLOT_KIND.text) {
      this.#sink.enqueue(slot.value);
      return;
    }
    const result = await slot.iterable;
    const iterable =
      result instanceof Nested ? this.#runNested(result.source, slot) : result;
    for await (const chunk of iterable) {
      this.#sink.enqueue(chunk);
    }
  }

  /**
   * Spawn a child engine to re-scan a nested replacement's output, and
   * return its emissions as an AsyncIterable that the outer drain loop
   * can consume in stream order.
   *
   * Push (child sink) → pull (outer for-await) bridging is a small
   * internal buffer plus a single-slot notifier.
   */
  async *#runNested(
    source: AsyncIterable<string>,
    parent: IterableSlotNode
  ): AsyncGenerator<string> {
    const buffer: string[] = [];
    let childErr: unknown = null;
    let childDone = false;
    let notify: (() => void) | null = null;
    const wake = () => {
      const pendingNotify = notify;
      notify = null;
      pendingNotify?.();
    };

    const child = new LookaheadEngine<TState, TMatch>(
      this.#options,
      {
        enqueue: (c) => {
          buffer.push(c);
          wake();
        },
        error: (e) => {
          childErr = e;
          childDone = true;
          wake();
        }
      },
      parent
    );
    child.start();

    void (async () => {
      try {
        for await (const chunk of source) {
          await child.write(chunk);
        }
        await child.end();
      } catch (err) {
        childErr ??= err;
      } finally {
        childDone = true;
        wake();
      }
    })();

    while (true) {
      while (buffer.length > 0) yield buffer.shift()!;
      if (childErr) throw childErr;
      if (childDone) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }
}
