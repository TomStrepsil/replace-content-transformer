import type {
  SearchStrategy,
  StreamIndices
} from "../../search-strategies/types.ts";
import type {
  AsyncTransformEngine,
  EngineSink,
  ReplacementContext
} from "../types.ts";
import type { ConcurrencyStrategy } from "./concurrency-strategy/types.ts";
import type { IterableSlotNode, SlotNode, TextSlotNode } from "./slot-tree/types.ts";
import { TransformEngineBase } from "../transform-engine-base.ts";
import { AsyncChildQueue } from "./slot-tree/async-child-queue.ts";
import { Nested } from "./nested.ts";
import { SLOT_KIND } from "./slot-tree/constants.ts";

/**
 * Extension of {@link ReplacementContext} specific to the lookahead engine.
 * Adds a {@link depth} field indicating the nesting level of the current
 * replacement — always `0` for top-level matches, incremented by `1` for each
 * recursive `nested()` level.
 */
export type LookaheadReplacementContext = ReplacementContext & {
  /**
   * Nesting depth of the current replacement.
   * `0` for top-level matches; incremented by 1 for each {@link nested} level.
   */
  depth: number;
};

/**
 * Default backpressure limit on the internal slot queue. Scanning
 * suspends when this many slots are buffered ahead of the drain loop.
 * Override via {@link AsyncLookaheadTransformEngineOptions.highWaterMark}
 * if your platform's sub-request ceiling exceeds this.
 */
export const DEFAULT_HIGH_WATER_MARK = 32;

/**
 * Wrap a replacement's `AsyncIterable<string>` so that the granted
 * concurrency slot is held through chunk production and released
 * exactly once when the producer reaches `done: true` (or throws, or
 * the consumer aborts the iterator early via `return()`).
 */
function textSlot(siblingIndex: number, value: string): TextSlotNode {
  return { kind: SLOT_KIND.text, siblingIndex, value };
}

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
  match: TMatch,
  context: LookaheadReplacementContext
) => Promise<AsyncIterable<string> | Nested>;

export interface AsyncLookaheadTransformEngineOptions<TState, TMatch> {
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
  /**
   * When aborted, the scanner stops calling the replacement function.
   * Matches discovered after the signal fires are emitted verbatim (using
   * {@link SearchStrategy.matchToString}) rather than being passed to
   * `replacement`. Any already-buffered partial match is flushed first so
   * output stays in order. In-flight replacements that were scheduled
   * before the signal fired are unaffected — they run to completion and
   * their output is emitted normally. Pair with {@link abandonPendingSignal}
   * to also abandon those.
   */
  stopReplacingSignal?: AbortSignal;
  /**
   * When aborted, any replacement whose output the drain loop has not yet
   * begun consuming is abandoned: its iterable is closed and the original
   * matched text is emitted in its place. A replacement the drain loop is
   * already iterating is allowed to complete normally — no partial output.
   * Scanning is also halted (implying {@link stopReplacingSignal} semantics)
   * — there is no useful combination where pending work is abandoned but
   * new replacements continue to be scheduled. Internally the engine
   * combines both signals via `AbortSignal.any()`.
   */
  abandonPendingSignal?: AbortSignal;
}

/**
 * Stream-protocol-agnostic core of the lookahead transformer.
 *
 * Owns the scan → schedule → drain pipeline: input chunks are fed via
 * {@link write}; the scanner produces text + iterable slots, pushes them
 * onto a bounded queue, and schedules replacement work through the
 * injected {@link ConcurrencyStrategy}. A concurrent drain loop
 * (started by {@link start}) dequeues slots in stream order and emits
 * chunks through the supplied {@link EngineSink}.
 *
 * Adapter classes (`ReplaceContentTransformer` in web,
 * `AsyncReplaceContentTransform` in node) wrap this engine, mapping
 * their runtime's transform lifecycle onto `start`/`write`/`end`.
 *
 * Nested re-scanning (returned via the `nested()` sentinel) is handled
 * internally by spawning a child engine and bridging its sink into the
 * outer drain loop — adapters need not plumb nesting themselves.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type
 */
export class AsyncLookaheadTransformEngine<TState, TMatch>
  extends TransformEngineBase<TState, TMatch>
  implements AsyncTransformEngine
{
  readonly #options: AsyncLookaheadTransformEngineOptions<TState, TMatch>;
  readonly #parent: IterableSlotNode | null;
  readonly #queue: AsyncChildQueue;
  readonly #depth: number;

  #siblingIndex = 0;
  #drainDone: Promise<void> | null = null;

  constructor(
    options: AsyncLookaheadTransformEngineOptions<TState, TMatch>,
    /**
     * @internal Set by the outer engine when spawning a child to re-scan
     * a {@link Nested} replacement. Not part of the public adapter API.
     */
    parent: IterableSlotNode | null = null,
    /**
     * @internal Nesting depth; 0 for the root engine, incremented by 1 for
     * each child spawned via {@link #runNested}. Surfaced as
     * {@link LookaheadReplacementContext.depth} in replacement callbacks.
     */
    depth: number = 0
  ) {
    const scanSignals = [options.stopReplacingSignal, options.abandonPendingSignal]
      .filter((s): s is AbortSignal => s !== undefined);
    super(
      options.searchStrategy,
      scanSignals.length > 0 ? AbortSignal.any(scanSignals) : undefined
    );
    this.#options = options;
    this.#parent = parent;
    this.#depth = depth;
    this.#queue = new AsyncChildQueue(
      options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK
    );
  }

  /**
   * Attach the output sink and start the drain loop.
   * Must be called exactly once before {@link write}.
   */
  override start(sink: EngineSink): void {
    super.start(sink);
    this.#drainDone = this.#drain().catch((err) => {
      this._sink!.error(err);
      throw err;
    });
  }

  /**
   * Feed one input chunk into the scanner. Suspends when the internal
   * queue is full (backpressure).
   */
  async write(chunk: string): Promise<void> {
    if (this._stopReplacingSignal?.aborted) {
      const tail = this._searchStrategy.flush(this._state);
      if (tail.length > 0) {
        await this.#queue.push(textSlot(this.#siblingIndex++, tail));
      }
      await this.#queue.push(textSlot(this.#siblingIndex++, chunk));
      return;
    }

    for (const result of this._searchStrategy.processChunk(chunk, this._state)) {
      if (!result.isMatch) {
        await this.#queue.push(textSlot(this.#siblingIndex++, result.content));
        continue;
      }
      if (this._stopReplacingSignal?.aborted) {
        await this.#queue.push(textSlot(this.#siblingIndex++, this._searchStrategy.matchToString(result.content)));
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
  override async end(): Promise<void> {
    const tail = this._searchStrategy.flush(this._state);
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
    const matchIndex = this._matchIndex++;
    const node: IterableSlotNode = {
      kind: SLOT_KIND.iterable,
      siblingIndex: this.#siblingIndex++,
      depth: this.#depth,
      parent: this.#parent,
      getOriginalContent:
        this.#options.abandonPendingSignal !== undefined
          ? () => this._searchStrategy.matchToString(match)
          : undefined,
      iterable: undefined
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
      result = await this.#options.replacement(match, { matchIndex, streamIndices, depth: this.#depth });
    } catch (err) {
      release();
      throw err;
    }
    if (result instanceof Nested) {
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
      this._sink!.enqueue(slot.value);
      return;
    }
    const result = await slot.iterable!;
    if (this.#options.abandonPendingSignal?.aborted) {
      if (!(result instanceof Nested)) {
        const iter = result[Symbol.asyncIterator]() as AsyncIterator<string>;
        await iter.return?.();
      }
      if (slot.getOriginalContent !== undefined) {
        this._sink!.enqueue(slot.getOriginalContent());
      }
      return;
    }
    const iterable =
      result instanceof Nested ? this.#runNested(result.source, slot) : result;
    for await (const chunk of iterable) {
      this._sink!.enqueue(chunk);
    }
  }

  /**
   * Spawn a child engine to re-scan a nested replacement's output, and
   * return its emissions as an AsyncIterable that the outer drain loop
   * can consume in stream order.
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

    const child = new AsyncLookaheadTransformEngine<TState, TMatch>(
      this.#options,
      parent,
      this.#depth + 1
    );
    child.start({
      enqueue: (c) => {
        buffer.push(c);
        wake();
      },
      error: (e) => {
        childErr = e;
        childDone = true;
        wake();
      }
    });

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
