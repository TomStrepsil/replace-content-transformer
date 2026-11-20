import type {
  MatchSink,
  SearchStrategy,
  StreamIndices
} from "../../search-strategies/types.ts";
import type {
  TransformEngine,
  ByteEngineSink,
  EngineSink,
  ReplacementContext,
  Utf8Bytes
} from "../types.ts";
import type { ConcurrencyStrategy } from "./concurrency-strategy/types.ts";
import type { IterableSlotNode, SlotNode, TextSlotNode } from "./slot-tree/types.ts";
import { TransformEngineBase } from "../transform-engine-base.ts";
import { AsyncChildQueue } from "./slot-tree/async-child-queue.ts";
import { validateWholeNumberAtLeast } from "../../search-strategies/buffer-guard.ts";
import { Nested } from "./nested.ts";
import { SLOT_KIND } from "./slot-tree/constants.ts";
import { closeAbandoned, ignore } from "../abandon.ts";
import { failedFromAbortOf } from "../abort-reason.ts";
import { cancellableForAwait, cancellableRead, type CancellableRead } from "../cancellable-read.ts";
import {
  acceptsBytes,
  replacementPieceForwarder,
  type ReplacementPieceForwarder
} from "../replacement-pieces.ts";

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
 * suspends at the next match once more slots than this are buffered ahead
 * of the drain loop.
 * Override via {@link LookaheadTransformEngineOptions.highWaterMark}
 * if your platform's sub-request ceiling exceeds this.
 */
export const DEFAULT_HIGH_WATER_MARK = 32;

function textSlot(siblingIndex: number, value: string): TextSlotNode {
  return { kind: SLOT_KIND.text, siblingIndex, value };
}

const isDefinedSignal = (s?: AbortSignal): s is AbortSignal => s !== undefined;

const ABANDONED = Symbol("abandoned");

function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T | typeof ABANDONED> {
  if (signal.aborted) {
    void promise.catch(ignore);
    return Promise.resolve(ABANDONED);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABANDONED);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

async function* emptyAsyncIterable(): AsyncGenerator<string> {}

class SlotPermit implements EventListenerObject {
  streaming = false;
  reading: CancellableRead<string | Utf8Bytes> | undefined = undefined;
  readonly signal: AbortSignal;
  #acquired: (() => void) | undefined;
  readonly #controller: AbortController | undefined;
  readonly #cancelSignal: AbortSignal;
  readonly #abandonSignal: AbortSignal;

  constructor(
    acquired: () => void,
    cancelSignal: AbortSignal,
    abandonSignal: AbortSignal,
    controller: AbortController | undefined
  ) {
    this.#acquired = acquired;
    this.#cancelSignal = cancelSignal;
    this.#abandonSignal = abandonSignal;
    this.#controller = controller;
    this.signal = controller === undefined ? cancelSignal : controller.signal;
    abandonSignal.addEventListener("abort", this);
    cancelSignal.addEventListener("abort", this);
  }

  handleEvent(event: Event): void {
    const cancelled = event.target === this.#cancelSignal;
    if (!cancelled && this.streaming) return;
    if (cancelled) this.reading?.cancel();
    this.#controller?.abort();
    this.finish();
  }

  releaseSlot(): void {
    const acquired = this.#acquired;
    if (acquired === undefined) return;
    this.#acquired = undefined;
    acquired();
  }

  finish(): void {
    this.#abandonSignal.removeEventListener("abort", this);
    this.#cancelSignal.removeEventListener("abort", this);
    this.releaseSlot();
  }
}

/**
 * Async function called for each match to produce its replacement content.
 *
 * Return a plain `AsyncIterable` of strings and UTF-8 bytes (e.g. a `fetch`
 * response body) to emit the replacement chunks verbatim, or a
 * {@link Nested} (via the `nested()` helper) to opt in to recursive
 * re-scanning of the replacement content by a child engine that shares this
 * engine's configuration.
 *
 * Bytes are read as UTF-8, as one sequence for each replacement, so a
 * character split across its pieces is kept whole, and one it leaves
 * incomplete becomes U+FFFD, as do malformed bytes. A byte order mark at the
 * start of a replacement's bytes, or of bytes that follow a string it
 * yields, is dropped. A sink with `EngineSink.acceptsBytes` receives them
 * without their being decoded (see `ByteEngineSink`); otherwise they are
 * decoded.
 */
export type LookaheadReplacementFn<TMatch> = (
  match: TMatch,
  context: LookaheadReplacementContext
) => Promise<AsyncIterable<string | Utf8Bytes> | Nested<string | Utf8Bytes>>;

export interface LookaheadTransformEngineOptions<TState, TMatch> {
  /** Search strategy used to locate matches in the input stream. */
  searchStrategy: SearchStrategy<TState, TMatch>;
  /** Function invoked for every match; result is streamed in place of the match. */
  replacement: LookaheadReplacementFn<TMatch>;
  /**
   * Pluggable strategy controlling when and in what order replacement
   * work is initiated. See {@link SemaphoreStrategy} (simple FIFO) and
   * {@link PriorityQueueStrategy} (tree-aware prioritisation).
   */
  concurrencyStrategy: ConcurrencyStrategy;
  /**
   * Maximum number of buffered slots in the internal queue before
   * scanning suspends, at the next match. The text before a match is
   * queued as one slot with it, so the queue holds at most two slots more.
   * Provides backpressure when the drain loop (downstream emission) lags
   * behind the scanner.
   *
   * @default 32
   */
  highWaterMark?: number;
  /**
   * When aborted, the scanner stops calling the replacement function and
   * stops searching: what is left of the current chunk and what the strategy
   * holds are emitted verbatim as one chunk, and later chunks pass through
   * unchanged. No replacement is called once the
   * signal has fired: a match scheduled earlier whose replacement has not
   * been called, such as one still waiting for a concurrency slot, is
   * emitted verbatim in its place, without waiting for the slot. Replacements
   * already called run to completion. One that fails with the signal's
   * `reason` or an `AbortError`, or an error with either in its `cause`
   * chain, as a `fetch` passed the signal does, ends there instead of
   * erroring the stream: its match is emitted verbatim if it had produced
   * nothing, and otherwise only what it produced. The content of a {@link nested}
   * replacement is re-scanned under the same signal, so its own matches
   * follow these rules too. Pair with {@link abandonPendingSignal} to also
   * abandon replacements already called.
   */
  stopReplacingSignal?: AbortSignal;
  /**
   * When aborted, any replacement whose output the drain loop has not yet
   * begun consuming is abandoned: its iterable is closed and the original
   * matched text is emitted in its place. A replacement the drain loop is
   * already iterating is allowed to complete normally — no partial output.
   * Scanning is also halted (implying {@link stopReplacingSignal} semantics):
   * no further replacements are scheduled and the rest of the input passes
   * through as raw text — there is no useful combination where pending work
   * is abandoned but new replacements continue to be scheduled. Internally
   * the engine combines both signals via `AbortSignal.any()`.
   *
   * The `signal` in the context of an abandoned replacement aborts with it,
   * including a {@link nested} replacement whose source has not begun to be
   * read, so a `fetch` passed that signal stops straight away. That of a
   * replacement whose output is being emitted does not.
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
 * Adapter classes (`ReplaceContentTransformer` and
 * `ReplaceContentTextTransformer` in web, `ReplaceContentTransform` in node) wrap this engine, mapping
 * their runtime's transform lifecycle onto `start`/`write`/`end`.
 *
 * Nested re-scanning (returned via the `nested()` sentinel) is handled
 * internally by spawning a child engine and bridging its sink into the
 * outer drain loop — adapters need not plumb nesting themselves.
 *
 * @throws {RangeError} If `highWaterMark` is not a whole number of at least 1.
 * `Infinity` is allowed; `undefined` selects the default.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type
 */
export class LookaheadTransformEngine<TState, TMatch>
  extends TransformEngineBase<TState, TMatch>
  implements TransformEngine
{
  readonly #options: LookaheadTransformEngineOptions<TState, TMatch>;
  readonly #parent: IterableSlotNode | null;
  readonly #queue: AsyncChildQueue;
  readonly #depth: number;
  readonly #cancelAbortController: AbortController;
  readonly #abandonSignal: AbortSignal;
  readonly #scanStopSignal: AbortSignal;
  readonly #permits = new WeakMap<IterableSlotNode, SlotPermit>();

  #siblingIndex = 0;
  #drainDone: Promise<void> | null = null;
  #cancelled = false;
  #paused = false;
  #text = "";
  #pieces!: ReplacementPieceForwarder;
  #byteSink: ByteEngineSink | undefined;
  readonly #matchSink: MatchSink<TMatch> = {
    reportText: (content) => {
      this.#text += content;
    },
    reportMatch: (match, streamIndices) => {
      if (this._stopReplacingSignal?.aborted) {
        this.#text += this._searchStrategy.matchToString(match);
        return false;
      }
      this.#offerText();
      this.#queue.offer(this.#scheduleMatch(match, streamIndices));
      if (!this.#queue.full) return true;
      this.#paused = true;
      return false;
    }
  };

  constructor(
    options: LookaheadTransformEngineOptions<TState, TMatch>,
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
    const { highWaterMark = DEFAULT_HIGH_WATER_MARK } = options;
    validateWholeNumberAtLeast("highWaterMark", highWaterMark, 1);
    const cancelAbortController = new AbortController();
    const abandonSignal = AbortSignal.any(
      [options.abandonPendingSignal, cancelAbortController.signal].filter(isDefinedSignal)
    );
    const scanSignals = [options.stopReplacingSignal, abandonSignal]
      .filter(isDefinedSignal);
    const scanStopSignal = AbortSignal.any(scanSignals);
    super(options.searchStrategy, scanStopSignal);
    this.#scanStopSignal = scanStopSignal;
    this.#options = options;
    this.#parent = parent;
    this.#depth = depth;
    this.#queue = new AsyncChildQueue(highWaterMark);
    this.#cancelAbortController = cancelAbortController;
    this.#abandonSignal = abandonSignal;
  }

  /**
   * Abort all in-flight work and close the engine without emitting further
   * output. Any write() suspended on backpressure is unblocked immediately.
   * A `ReadableStream` replacement or `nested()` source is cancelled,
   * whether or not it is being read, and the `signal` in the context of
   * each replacement not yet read to its end is aborted.
   * Original match text is not emitted even when `abandonPendingSignal` is configured.
   * After `cancel()`, `end()` resolves cleanly without hanging.
   */
  cancel(): void {
    this.#cancelled = true;
    this.#cancelAbortController.abort();
    this.#queue.close();
  }

  /**
   * Attach the output sink and start the drain loop.
   * Must be called exactly once before {@link write}.
   */
  override start(sink: EngineSink): void {
    super.start(sink);
    this.#pieces = replacementPieceForwarder(this._failureRecordingSink(sink));
    this.#byteSink = acceptsBytes(sink) ? sink : undefined;
    this.#drainDone = this.#drain().catch((err) => {
      this.cancel();
      void this.#abandonRemaining();
      this._sink.error(err);
      throw err;
    });
    void this.#drainDone.catch(ignore);
  }

  /**
   * Feed one input chunk into the scanner. Suspends when the internal
   * queue is full (backpressure). Rejects with what the search throws, such
   * as from `onGuardExceeded`, cancelling the engine.
   */
  write(chunk: string): Promise<void> {
    if (this.#cancelled) return Promise.resolve();
    if (this._stopReplacingSignal?.aborted) return this.#passThrough(chunk);
    return this.#search(chunk, false);
  }

  async #passThrough(chunk: string): Promise<void> {
    await this.#enqueueHeld();
    if (this.#cancelled) return;
    await this.#queue.push(textSlot(this.#siblingIndex++, chunk));
  }

  async #search(chunk: string, settling: boolean): Promise<void> {
    try {
      if (settling) this._settle(this.#matchSink);
      else this._searchStrategy.processChunk(chunk, this._state, this.#matchSink);
      await this.#enqueue(settling);
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  #offerText(): void {
    if (!this.#text) return;
    this.#queue.offer(textSlot(this.#siblingIndex++, this.#text));
    this.#text = "";
  }

  #offerSearched(): void {
    if (this._stopReplacingSignal?.aborted) this.#text += this._searchStrategy.flush(this._state);
    this.#offerText();
  }

  async #enqueueHeld(): Promise<void> {
    const held = this._searchStrategy.flush(this._state);
    if (held) await this.#queue.push(textSlot(this.#siblingIndex++, held));
  }

  async #enqueue(settling: boolean): Promise<void> {
    this.#offerSearched();
    while (this.#queue.full) {
      await this.#queue.room();
      if (this.#cancelled) return;
      if (this._stopReplacingSignal?.aborted) return this.#enqueueHeld();
      if (this.#paused) {
        this.#paused = false;
        this._resume(settling, this.#matchSink);
        this.#offerSearched();
      }
    }
  }

  /**
   * Signal end-of-input. Emits any trailing content held by the search
   * strategy, closes the queue, and waits for the drain loop to finish.
   * Rejects with the first error raised by the search (cancelling the
   * engine), the drain loop or any scheduled replacement, so adapters can
   * forward failures.
   */
  override async end(): Promise<void> {
    if (this.#cancelled) {
      await this.#drainDone;
      return;
    }
    if (this._stopReplacingSignal?.aborted) await this.#enqueueHeld();
    else await this.#search("", true);
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
        this.#options.abandonPendingSignal !== undefined ||
        this.#options.stopReplacingSignal !== undefined
          ? () => this._searchStrategy.matchToString(match)
          : undefined,
      iterable: undefined
    };
    node.iterable = this.#runSlot(node, match, matchIndex, streamIndices);
    void node.iterable.catch(ignore);
    return node;
  }

  async #runSlot(
    node: IterableSlotNode,
    match: TMatch,
    matchIndex: number,
    streamIndices: StreamIndices
  ): Promise<AsyncIterable<string | Utf8Bytes> | Nested<string | Utf8Bytes>> {
    const acquired = await this.#options.concurrencyStrategy.acquire(node);
    if (this.#scanStopSignal.aborted) {
      acquired();
      return emptyAsyncIterable();
    }
    const permit = new SlotPermit(
      acquired,
      this.#cancelAbortController.signal,
      this.#abandonSignal,
      this.#options.abandonPendingSignal === undefined ? undefined : new AbortController()
    );
    this.#permits.set(node, permit);
    try {
      const result = await this.#options.replacement(match, {
        matchIndex,
        streamIndices,
        depth: this.#depth,
        signal: permit.signal
      });
      if (result instanceof Nested) permit.releaseSlot();
      return result;
    } catch (err) {
      permit.finish();
      throw err;
    }
  }

  async #drain(): Promise<void> {
    for await (const slot of this.#queue) {
      await this.#emitSlot(slot);
    }
  }

  async #abandonRemaining(): Promise<void> {
    for await (const slot of this.#queue) {
      await this.#emitSlot(slot).catch(() => {});
    }
  }

  async #emitSlot(slot: SlotNode): Promise<void> {
    if (slot.kind === SLOT_KIND.text) {
      if (!this.#cancelled) this._enqueueTo(this._sink, slot.value);
      return;
    }
    try {
      let result = await untilAborted(slot.iterable!, this.#scanStopSignal);
      if (result === ABANDONED && !this.#abandonSignal.aborted && this.#replacementCalled(slot)) {
        result = await untilAborted(slot.iterable!, this.#abandonSignal);
      }
      if (result === ABANDONED || this.#abandonSignal.aborted) {
        void slot.iterable!
          .then((result) => closeAbandoned(result instanceof Nested ? result.source : result))
          .catch(ignore);
        if (slot.getOriginalContent !== undefined && !this.#cancelled) {
          this._enqueueTo(this._sink, slot.getOriginalContent());
        }
        return;
      }
      const emitted =
        result instanceof Nested
          ? this.#emitNested(this.#runNested(result.source, slot, this.#streamingPermit(slot)))
          : this.#emitReplacement(result, this.#streamingPermit(slot));
      await untilAborted(emitted, this.#cancelAbortController.signal);
    } catch (error) {
      if (!this.#stoppedBy(error)) throw error;
      if (!this.#cancelled) this.#pieces.end(slot.getOriginalContent!());
    }
  }

  #streamingPermit(slot: IterableSlotNode): SlotPermit {
    const permit = this.#permits.get(slot)!;
    permit.streaming = true;
    return permit;
  }

  async #emitReplacement(source: AsyncIterable<string | Utf8Bytes>, permit: SlotPermit): Promise<void> {
    try {
      permit.reading = cancellableRead(source);
      for await (const piece of permit.reading.pieces) {
        if (this.#cancelled) return;
        this.#pieces.piece(piece);
        if (this.#cancelled) return;
      }
    } finally {
      permit.finish();
    }
    if (!this.#cancelled) this.#pieces.end();
  }

  #stoppedBy(error: unknown): boolean {
    return !this._sinkFailed && failedFromAbortOf(this.#options.stopReplacingSignal, error);
  }

  #replacementCalled(slot: IterableSlotNode): boolean {
    return this.#permits.has(slot);
  }

  async #emitNested(output: AsyncIterable<string | Utf8Bytes>): Promise<void> {
    for await (const chunk of output) {
      if (this.#cancelled) return;
      if (typeof chunk === "string") this._enqueueTo(this._sink, chunk);
      else this._enqueueTo(this.#byteSink!, chunk);
      if (this.#cancelled) return;
    }
  }

  /**
   * Spawn a child engine to re-scan a nested replacement's output, and
   * return its emissions as an AsyncIterable that the outer drain loop
   * can consume in stream order.
   */
  async *#runNested(
    source: AsyncIterable<string | Utf8Bytes>,
    parent: IterableSlotNode,
    permit: SlotPermit
  ): AsyncGenerator<string | Utf8Bytes> {
    const buffer: (string | Utf8Bytes)[] = [];
    let failure: { error: unknown } | undefined;
    let childDone = false;
    let notify: (() => void) | null = null;
    const wake = () => {
      const pendingNotify = notify;
      notify = null;
      pendingNotify?.();
    };

    const child = new LookaheadTransformEngine<TState, TMatch>(
      { ...this.#options, abandonPendingSignal: this.#abandonSignal },
      parent,
      this.#depth + 1
    );
    child.start({
      enqueue: (c: string | Utf8Bytes) => {
        buffer.push(typeof c === "string" ? c : new Uint8Array(c));
        wake();
      },
      error: (e) => {
        failure = { error: e };
        childDone = true;
        wake();
      },
      acceptsBytes: this.#byteSink !== undefined
    });

    let reading: CancellableRead<string | Utf8Bytes> | undefined;
    const cancelChild = () => {
      child.cancel();
      reading?.cancel();
    };
    this.#cancelAbortController.signal.addEventListener("abort", cancelChild, { once: true });

    void (async () => {
      let decoded = "";
      const pieces = replacementPieceForwarder({
        enqueue: (text: string) => {
          decoded += text;
        }
      });
      const writeDecoded = async () => {
        const text = decoded;
        decoded = "";
        if (text && !this.#cancelled && !failure) await child.write(text);
      };
      try {
        let original = "";
        try {
          reading = cancellableForAwait(source);
          for await (const piece of reading.pieces) {
            pieces.piece(piece);
            await writeDecoded();
            if (this.#cancelled || failure) break;
          }
        } catch (err) {
          if (!this.#stoppedBy(err)) throw err;
          original = parent.getOriginalContent!();
        } finally {
          permit.finish();
        }
        pieces.end(original);
        await writeDecoded();
        await child.end();
      } catch (err) {
        child.cancel();
        failure ??= { error: err };
      } finally {
        this.#cancelAbortController.signal.removeEventListener("abort", cancelChild);
        childDone = true;
        wake();
      }
    })();

    while (true) {
      while (buffer.length > 0) yield buffer.shift()!;
      if (failure) throw failure.error;
      if (childDone) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }
}
