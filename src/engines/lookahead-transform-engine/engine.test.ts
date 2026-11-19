import { describe, it, expect, expectTypeOf, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { LookaheadTransformEngine, type LookaheadReplacementFn } from "./engine.ts";
import { SemaphoreStrategy } from "./concurrency-strategy/semaphore-strategy.ts";
import type { ConcurrencyStrategy } from "./concurrency-strategy/types.ts";
import type { SlotTreeNode, IterableSlotNode } from "./slot-tree/types.ts";
import { nested, type Nested } from "./nested.ts";
import type { EngineSink, Utf8Bytes } from "../types.ts";
import type { MatchResult } from "../../../test/utilities.ts";
import {
  abortErrorCausedBy,
  abortingOnFirstCall,
  asyncIterable,
  collectEngineSink,
  mockSearchStrategy,
  mockSearchStrategyFactory,
  foreignRealmUtf8,
  inResizableArrayBuffer,
  refuseResizableBuffersInTextDecoder,
  sinkKinds,
  textOfPieces,
  unhandledRejectionsDuring,
  utf8
} from "../../../test/utilities.ts";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.ts";

function heldSlotCounter(concurrency: number) {
  const inner = new SemaphoreStrategy(concurrency);
  let held = 0;
  const strategy: ConcurrencyStrategy = {
    async acquire() {
      const release = await inner.acquire();
      held++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held--;
        release();
      };
    }
  };
  return { strategy, held: () => held };
}

function never<T>(): Promise<T> {
  return new Promise(() => {});
}

function grantingOnly(count: number): ConcurrencyStrategy {
  let remaining = count;
  return {
    acquire: () => (remaining-- > 0 ? Promise.resolve(() => {}) : never())
  };
}

function braceStrategy() {
  const { strategy } = mockSearchStrategy({
    chunk: (chunk: string) => {
      const steps: MatchResult[] = [];
      const re = /\{\{(\w+)\}\}/g;
      let last = 0;
      let found: RegExpExecArray | null;
      while ((found = re.exec(chunk)) !== null) {
        if (found.index > last) steps.push({ isMatch: false, content: chunk.slice(last, found.index) });
        steps.push({ isMatch: true, content: found[1], streamIndices: [found.index, re.lastIndex] });
        last = re.lastIndex;
      }
      if (last < chunk.length) steps.push({ isMatch: false, content: chunk.slice(last) });
      return steps;
    }
  });
  strategy.matchToString.mockImplementation((match: string) => `{{${match}}}`);
  return strategy;
}

function stalledBeforeFirstItem(): AsyncIterable<string> {
  return (async function* () {
    await never<void>();
    yield "R";
  })();
}

function matchEveryChunk() {
  return mockSearchStrategy({
    chunk: (chunk: string) => [{ isMatch: true, content: chunk, streamIndices: [0, chunk.length] }]
  }).strategy;
}

async function* stalledAfterFirstItem(): AsyncGenerator<string> {
  yield "child";
  await never<void>();
}

async function runEngine(
  engine: LookaheadTransformEngine<object, string>,
  sink: EngineSink,
  inputs: string[]
): Promise<void> {
  engine.start(sink);
  for (const input of inputs) await engine.write(input);
  await engine.end();
}

describe("LookaheadTransformEngine", () => {
  describe("text slots", () => {
    it("emits non-match text directly to the sink", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "hello " },
        { isMatch: false, content: "world" }
      );
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("unused"),
        concurrencyStrategy: new SemaphoreStrategy(2)
      });
      await runEngine(engine, sink, ["hello world"]);
      expect(chunks.join("")).toBe("hello world");
    });

    it("emits the search-strategy flush tail when non-empty", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "head "
      });
      strategy.flush.mockReturnValue("tail");
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable(""),
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      await runEngine(engine, sink, ["head "]);
      expect(chunks.join("")).toBe("head tail");
      expect(strategy.flush).toHaveBeenCalledOnce();
    });

    it("does not emit a tail slot when flush returns an empty string", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "only"
      });
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable(""),
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      await runEngine(engine, sink, ["only"]);
      expect(chunks).toEqual(["only"]);
    });

    it("enqueues every settled result before closing the queue on end()", async () => {
      const { strategy } = mockSearchStrategy({
        chunk: [{ isMatch: true, content: "M", streamIndices: [0, 1] }],
        settled: [
          { isMatch: false, content: "T1" },
          { isMatch: true, content: "M", streamIndices: [1, 2] },
          { isMatch: false, content: "T2" },
          { isMatch: true, content: "M", streamIndices: [3, 4] },
          { isMatch: false, content: "T3" }
        ]
      });
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        highWaterMark: 1
      });
      engine.start(sink);
      await engine.write("M");

      const endPromise = engine.end();
      gate.resolve(asyncIterable("R"));
      await endPromise;
      expect(chunks).toEqual(["R", "T1", "R", "T2", "R", "T3"]);
    });
  });

  describe("match slots", () => {
    it("emits replacement iterable chunks in place of each match", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "pre " },
        { isMatch: true, content: "M", streamIndices: [4, 5] },
        { isMatch: false, content: " post" }
      );
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("A1", "A2"),
        concurrencyStrategy: new SemaphoreStrategy(2)
      });
      await runEngine(engine, sink, ["pre M post"]);
      expect(chunks.join("")).toBe("pre A1A2 post");
    });

    it("preserves output order across multiple matches even when later ones resolve first", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: false, content: "-" },
        { isMatch: true, content: "B", streamIndices: [2, 3] }
      );
      const gateA = Promise.withResolvers<AsyncIterable<string>>();
      const gateB = Promise.withResolvers<AsyncIterable<string>>();
      let callCount = 0;

      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () =>
          callCount++ === 0 ? gateA.promise : gateB.promise,
        concurrencyStrategy: new SemaphoreStrategy(2)
      });
      engine.start(sink);
      await engine.write("A-B");

      // Later match resolves first.
      gateB.resolve(asyncIterable("b"));
      await setImmediate();
      expect(chunks).toEqual([]);

      gateA.resolve(asyncIterable("a"));
      await engine.end();
      expect(chunks.join("")).toBe("a-b");
    });

    it("initiates later replacement work eagerly while earlier work is pending", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: true, content: "B", streamIndices: [1, 2] }
      );
      const firstGate = Promise.withResolvers<AsyncIterable<string>>();
      const started: number[] = [];
      let callCount = 0;

      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => {
          const callIndex = callCount++;
          started.push(callIndex);
          return callIndex === 0 ? firstGate.promise : asyncIterable("b");
        },
        concurrencyStrategy: new SemaphoreStrategy(2)
      });
      engine.start(sink);
      await engine.write("AB");
      expect(started).toEqual([0, 1]);
      firstGate.resolve(asyncIterable("a"));
      await engine.end();
    });

    it("passes match and context (matchIndex, streamIndices) to the replacement function", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: true, content: "B", streamIndices: [3, 4] }
      );
      const replacement = vi.fn(async () => asyncIterable(""));

      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy: new SemaphoreStrategy(2)
      });
      await runEngine(engine, sink, ["AB"]);

      expect(replacement).toHaveBeenNthCalledWith(1, "A", { matchIndex: 0, streamIndices: [0, 1], depth: 0 });
      expect(replacement).toHaveBeenNthCalledWith(2, "B", { matchIndex: 1, streamIndices: [3, 4], depth: 0 });
    });

    it("hands each match's slot to the concurrency strategy with a null parent at the root", async () => {
      const scheduled: SlotTreeNode[] = [];
      const spy: ConcurrencyStrategy = {
        async acquire(node) {
          scheduled.push(node);
          return () => {};
        }
      };
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: true, content: "B", streamIndices: [1, 2] }
      );
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("x"),
        concurrencyStrategy: spy
      });
      await runEngine(engine, sink, ["AB"]);
      expect(scheduled).toHaveLength(2);
      expect(scheduled.map((slot) => slot.siblingIndex)).toEqual([0, 1]);
      expect(scheduled.every((slot) => slot.parent === null)).toBe(true);
    });
  });

  describe("slot iterator return()", () => {
    async function scheduledSlotIterator(
      replacementIterator: AsyncIterator<string>
    ) {
      const scheduled: SlotTreeNode[] = [];
      const spy: ConcurrencyStrategy = {
        async acquire(node) {
          scheduled.push(node);
          return () => {};
        }
      };
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement: async () => ({
          [Symbol.asyncIterator]: () => replacementIterator
        }),
        concurrencyStrategy: spy
      });
      await runEngine(engine, sink, ["M"]);
      const resolved = await (scheduled[0] as IterableSlotNode).iterable;
      return (resolved as AsyncIterable<string>)[Symbol.asyncIterator]();
    }

    it("forwards the value to the replacement iterator's return() and yields its result", async () => {
      const innerResult = { done: true as const, value: "inner-result" };
      const innerReturn = vi.fn(async () => innerResult);
      const slotIterator = await scheduledSlotIterator({
        next: async () => ({ done: true, value: undefined }),
        return: innerReturn
      });
      const result = await slotIterator.return!("passed-value");
      expect(innerReturn).toHaveBeenCalledExactlyOnceWith("passed-value");
      expect(result).toBe(innerResult);
    });

    it("yields a done result carrying the value when the replacement iterator has no return()", async () => {
      const slotIterator = await scheduledSlotIterator({
        next: async () => ({ done: true, value: undefined })
      });
      expect(await slotIterator.return!("passed-value")).toEqual({
        done: true,
        value: "passed-value"
      });
    });
  });

  describe("backpressure", () => {
    it("suspends write() once highWaterMark buffered slots are reached", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] },
        { isMatch: true, content: "M", streamIndices: [2, 3] }
      );
      const gates = [0, 1, 2].map(() => Promise.withResolvers<AsyncIterable<string>>());
      let callCount = 0;

      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => gates[callCount++].promise,
        concurrencyStrategy: new SemaphoreStrategy(8),
        highWaterMark: 1
      });
      engine.start(sink);

      let writeResolved = false;
      const writePromise = engine.write("MMM").then(() => {
        writeResolved = true;
      });
      await setImmediate();
      expect(writeResolved).toBe(false);

      gates[0].resolve(asyncIterable("a"));
      await writePromise;
      expect(writeResolved).toBe(true);

      gates[1].resolve(asyncIterable("b"));
      gates[2].resolve(asyncIterable("c"));
      await engine.end();
    });

    const engineWith = (highWaterMark: unknown) => () =>
      new LookaheadTransformEngine({
        searchStrategy: mockSearchStrategyFactory(),
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: new SemaphoreStrategy(1),
        highWaterMark: highWaterMark as number
      });

    it.each([0, -1, Number.NaN, null, "32"])("rejects a highWaterMark of %j", (highWaterMark) => {
      expect(engineWith(highWaterMark)).toThrow(
        `highWaterMark must be a number of at least 1 (or Infinity), received ${String(highWaterMark)}`
      );
    });

    it("rejects a fractional highWaterMark", () => {
      expect(engineWith(1.5)).toThrow(
        "highWaterMark must be a whole number (or Infinity), received 1.5"
      );
    });

    it.each([1, Infinity, undefined])("accepts a highWaterMark of %j", (highWaterMark) => {
      expect(engineWith(highWaterMark)).not.toThrow();
    });

    it("suspends a write() with no match while more than highWaterMark slots are queued", async () => {
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        replacement: () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(8),
        highWaterMark: 1
      });
      engine.start(sink);
      await engine.write("{{a}}");
      await engine.write("x");

      let writeResolved = false;
      const writePromise = engine.write("y").then(() => {
        writeResolved = true;
      });
      await setImmediate();
      expect(writeResolved).toBe(false);

      gate.resolve(asyncIterable("A"));
      await writePromise;
      await engine.end();
      expect(chunks).toEqual(["A", "x", "y"]);
    });

    it("keeps write() suspended after a resumed scan while the text it queued fills the queue", async () => {
      const gateA = Promise.withResolvers<AsyncIterable<string>>();
      const gateB = Promise.withResolvers<AsyncIterable<string>>();
      const gated = new Map([["a", gateA.promise], ["b", gateB.promise]]);
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        replacement: async (match: string) => gated.get(match) ?? asyncIterable(match.toUpperCase()),
        concurrencyStrategy: new SemaphoreStrategy(8),
        highWaterMark: 1
      });
      engine.start(sink);

      let writeResolved = false;
      const writePromise = engine.write("{{a}}{{b}}{{c}}tail").then(() => {
        writeResolved = true;
      });
      gateA.resolve(asyncIterable("A"));
      await setImmediate();
      expect(writeResolved).toBe(false);

      gateB.resolve(asyncIterable("B"));
      await writePromise;
      await engine.end();
      expect(chunks).toEqual(["A", "B", "C", "tail"]);
    });

    it.each([
      { stage: "a chunk", paused: "chunk", scans: [["chunk"], [""]], settles: 1 },
      { stage: "the end of the stream", paused: "settled", scans: [["chunk"]], settles: 2 }
    ] as const)("resumes $stage paused on a full queue the way it was scanning", async ({ paused, scans, settles }) => {
      const steps: MatchResult[] = [
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] },
        { isMatch: true, content: "M", streamIndices: [2, 3] },
        { isMatch: false, content: "tail" }
      ];
      const { strategy } = mockSearchStrategy({
        chunk: paused === "chunk" ? steps : [],
        settled: paused === "settled" ? steps : []
      });
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: new SemaphoreStrategy(8),
        highWaterMark: 1
      });
      engine.start(sink);

      await engine.write("chunk");
      await engine.end();

      expect(chunks.join("")).toBe("RRRtail");
      expect(strategy.processChunk.mock.calls.map(([haystack]) => [haystack])).toEqual(scans);
      expect(strategy.settle).toHaveBeenCalledTimes(settles);
    });

    it("queues the text between two matches as one slot, however many pieces the strategy reports", async () => {
      const pieces = Array.from({ length: 100 }, (_, index): MatchResult => ({
        isMatch: false,
        content: String(index % 10)
      }));
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        ...pieces
      );
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        highWaterMark: 1
      });
      engine.start(sink);

      await engine.write("chunk");
      gate.resolve(asyncIterable("R"));
      await engine.end();

      expect(chunks).toEqual(["R", "0123456789".repeat(10)]);
    });
  });

  describe("error propagation", () => {
    const sinkReplacementState = { closed: false };
    it("forwards a replacement failure to sink.error and rejects end()", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "M",
        streamIndices: [0, 1]
      });
      const { sink, errors } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => {
          throw new Error("boom");
        },
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);
      await engine.write("M");
      await expect(engine.end()).rejects.toThrow("boom");
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("boom");
    });

    it.each<[string, { first: () => Promise<AsyncIterable<string>>; sinkThrows?: boolean }]>([
      ["the replacement rejects", { first: async () => Promise.reject(new Error("drain failed")) }],
      [
        "its iterator cannot be created",
        {
          first: async () => ({
            [Symbol.asyncIterator]() {
              throw new Error("drain failed");
            }
          })
        }
      ],
      [
        "its next() throws synchronously",
        {
          first: async () => ({
            [Symbol.asyncIterator]() {
              return {
                next() {
                  throw new Error("drain failed");
                }
              };
            }
          })
        }
      ],
      ["its body errors mid-stream", { first: async () => {
        return {
          async *[Symbol.asyncIterator]() {
            yield "partial";
            throw new Error("drain failed");
          }
        };
      } }],
      ["the sink throws", {
        first: async () => {
          const iterable: AsyncIterable<string> = {
            async *[Symbol.asyncIterator]() {
              try {
                yield "R";
              } finally {
                sinkReplacementState.closed = true;
              }
            }
          };
          return iterable;
        },
        sinkThrows: true
      }]
    ])("releases every concurrency slot when the drain fails because %s", async (_, { first, sinkThrows }) => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] },
        { isMatch: true, content: "M", streamIndices: [2, 3] }
      );
      const replacement = vi
        .fn()
        .mockImplementationOnce(first)
        .mockImplementation(async () => asyncIterable("R"));
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(1);
      const { sink, errors } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy
      });
      engine.start(
        sinkThrows
          ? {
              ...sink,
              enqueue: () => {
                throw new Error("drain failed");
              }
            }
          : sink
      );
      await engine.write("MMM");
      await expect(engine.end()).rejects.toThrow("drain failed");
      expect(errors).toHaveLength(1);
      await vi.waitFor(() => expect(held()).toBe(0));
      if (sinkThrows) {
        // Downstream failure closes the replacement iterator.
        expect(sinkReplacementState.closed).toBe(true);
      }
    });

    it("closes a replacement iterator when the sink throws", async () => {
      let closed = false;
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => (async function* () {
          try {
            yield "R";
          } finally {
            closed = true;
          }
        })(),
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start({
        ...sink,
        enqueue() {
          throw new Error("sink failed");
        }
      });
      await engine.write("M");

      await expect(engine.end()).rejects.toThrow("sink failed");

      expect(closed).toBe(true);
    });

    it("keeps draining remaining slots and reports only the first error when a later slot also fails", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] },
        { isMatch: true, content: "M", streamIndices: [2, 3] }
      );
      const replacement = vi
        .fn()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockRejectedValueOnce(new Error("second failure"))
        .mockImplementation(async () => asyncIterable("R"));
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(1);
      const { sink, errors } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy
      });
      engine.start(sink);
      await engine.write("MMM");
      await expect(engine.end()).rejects.toThrow("first failure");
      await vi.waitFor(() => expect(held()).toBe(0));
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("first failure");
    });

    it("resolves a write() suspended on backpressure when the drain fails", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] },
        { isMatch: true, content: "M", streamIndices: [2, 3] }
      );
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      let callCount = 0;
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(4);
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => (callCount++ === 0 ? gate.promise : asyncIterable("R")),
        concurrencyStrategy,
        highWaterMark: 1
      });
      engine.start(sink);

      const writePromise = engine.write("MMM");
      gate.reject(new Error("drain failed"));

      await expect(writePromise).resolves.toBeUndefined();
      await expect(engine.end()).rejects.toThrow("drain failed");
      await vi.waitFor(() => expect(held()).toBe(0));
    });

    it("releases every concurrency slot when a nested engine's drain fails", async () => {
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) => [{ isMatch: true, content: chunk, streamIndices: [0, chunk.length] }] });
      let innerCalls = 0;
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(1);
      const { sink, errors } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        concurrencyStrategy,
        replacement: async (_match, { depth }) => {
          if (depth === 0) return nested(asyncIterable("a", "b", "c"));
          if (innerCalls++ === 0) throw new Error("drain failed");
          return asyncIterable("R");
        }
      });
      engine.start(sink);
      await engine.write("outer");
      await expect(engine.end()).rejects.toThrow("drain failed");
      expect(errors).toHaveLength(1);
      await vi.waitFor(() => expect(held()).toBe(0));
    });

    it("leaves no rejection unhandled when a later replacement rejects while an earlier one is still being read", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: true, content: "B", streamIndices: [1, 2] }
      );
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async (match) =>
          match === "A"
            ? (async function* () {
                yield "first";
                await setImmediate();
                await setImmediate();
              })()
            : Promise.reject(new Error("network")),
        concurrencyStrategy: new SemaphoreStrategy(2)
      });
      engine.start(collectEngineSink().sink);

      const unhandled = await unhandledRejectionsDuring(async () => {
        await engine.write("AB");
        await engine.end().catch(() => {});
      });

      expect(unhandled).toEqual([]);
    });
  });

  describe("stopReplacingSignal", () => {
    it("passes chunk through without calling replacement when already aborted", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const fn = vi.fn(async () => asyncIterable("R"));
      const ac = new AbortController();
      ac.abort();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: fn,
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });
      await runEngine(engine, sink, ["M"]);
      expect(chunks).toEqual(["M"]);
      expect(fn).not.toHaveBeenCalled();
    });

    it("flushes buffered search-strategy tail in-order before the first passthrough chunk", async () => {
      const strategy = mockSearchStrategyFactory({ isMatch: false, content: "a" });
      strategy.flush.mockReturnValueOnce("BUF").mockReturnValue("");
      const ac = new AbortController();
      ac.abort();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("X");
      await engine.write("Y");
      await engine.end();
      expect(chunks).toEqual(["BUF", "X", "Y"]);
    });

    it("enqueues the flushed text before the first passthrough chunk while the queue is full", async () => {
      const strategy = mockSearchStrategyFactory({ isMatch: true, content: "M", streamIndices: [0, 1] });
      strategy.flush.mockReturnValueOnce("BUF").mockReturnValue("");
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const ac = new AbortController();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal,
        highWaterMark: 1
      });
      engine.start(sink);
      await engine.write("M");
      ac.abort();

      const writePromise = engine.write("X");
      gate.resolve(asyncIterable("R"));
      await writePromise;
      await engine.end();
      expect(chunks).toEqual(["R", "BUF", "X"]);
    });

    it("emits what the strategy holds once, before the first passthrough chunk, when the signal is pre-aborted", async () => {
      const strategy = mockSearchStrategyFactory({ isMatch: false, content: "" });
      strategy.flush.mockReturnValueOnce("BUF").mockReturnValue("");
      const ac = new AbortController();
      ac.abort();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("X");
      await engine.write("Y");
      await engine.end();
      expect(chunks).toEqual(["BUF", "X", "Y"]);
    });

    it("emits a match scheduled before a mid-chunk abort verbatim when its replacement had not been called", async () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({
        chunk: [
          { isMatch: true, content: "A", streamIndices: [0, 1] },
          () => ac.abort(),
          { isMatch: true, content: "B", streamIndices: [1, 2] }
        ]
      });
      const fn = vi.fn(async () => asyncIterable("R"));
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement: fn,
        concurrencyStrategy: grantingOnly(0),
        stopReplacingSignal: ac.signal
      });
      await runEngine(engine, sink, ["AB"]);
      expect(chunks).toEqual(["A", "B"]);
      expect(fn).not.toHaveBeenCalled();
    });

    it("lets a replacement called before the signal aborts run to completion", async () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({
        chunk: [
          { isMatch: true, content: "A", streamIndices: [0, 1] },
          { isMatch: true, content: "B", streamIndices: [1, 2] }
        ]
      });
      const replacement = abortingOnFirstCall(ac, async () => asyncIterable("R"));
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy: new SemaphoreStrategy(2),
        stopReplacingSignal: ac.signal
      });
      await runEngine(engine, sink, ["AB"]);
      expect(chunks).toEqual(["R", "B"]);
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("uses matchToString to convert mid-chunk match text when emitting verbatim", async () => {
      const ac = new AbortController();
      const { strategy } = mockSearchStrategy({
        chunk: [() => ac.abort(), { isMatch: true, content: "M", streamIndices: [0, 1] }]
      });
      strategy.matchToString.mockReturnValue("raw-M");
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });
      await runEngine(engine, sink, ["M"]);
      expect(strategy.matchToString).toHaveBeenCalledWith("M");
      expect(chunks).toEqual(["raw-M"]);
    });

    it("emits a scheduled match verbatim, without calling replacement, when the signal aborts while it waits for a concurrency slot", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: false, content: " " },
        { isMatch: true, content: "B", streamIndices: [2, 3] }
      );
      strategy.matchToString.mockImplementation((match: string) => `raw-${match}`);
      const gate = Promise.withResolvers<void>();
      const ac = new AbortController();
      const replacement = vi.fn(async (match: string) => {
        await gate.promise;
        ac.abort();
        return asyncIterable(`<${match}>`);
      });
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(1);
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy,
        stopReplacingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("A B");
      gate.resolve();
      await engine.end();

      expect(chunks).toEqual(["<A>", " ", "raw-B"]);
      expect(replacement).toHaveBeenCalledOnce();
      expect(held()).toBe(0);
    });

    it("emits a slot waiting for a permit verbatim once the signal aborts, without waiting for the permit", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: true, content: "B", streamIndices: [1, 2] }
      );
      const ac = new AbortController();
      const replacement = vi.fn(async (match: string) => asyncIterable(`<${match}>`));
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy: grantingOnly(1),
        stopReplacingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("AB");
      await setImmediate();
      expect(chunks).toEqual(["<A>"]);

      ac.abort();
      await setImmediate();
      expect(chunks).toEqual(["<A>", "B"]);

      await engine.end();
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("emits a nested() replacement's child match verbatim when its replacement had not been called before the signal aborted", async () => {
      const ac = new AbortController();
      const replacement = vi.fn(async (match: string) => {
        if (match === "A") return nested(asyncIterable("{{a1}}{{a2}}"));
        if (match === "a1") {
          await setImmediate();
          ac.abort();
        }
        return asyncIterable(`${match.toUpperCase()}!`);
      });
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: braceStrategy(),
        replacement,
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });

      await runEngine(engine, sink, ["<{{A}}>"]);

      expect(chunks.join("")).toBe("<A1!{{a2}}>");
      expect(replacement.mock.calls.map(([match]) => match)).toEqual(["A", "a1"]);
    });

    it("lets a replacement already called finish while a queued one is emitted verbatim", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: true, content: "B", streamIndices: [1, 2] }
      );
      const ac = new AbortController();
      const replacement = vi.fn(async () =>
        (async function* () {
          yield "first";
          ac.abort();
          yield "second";
        })()
      );
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });
      await runEngine(engine, sink, ["AB"]);

      expect(chunks).toEqual(["first", "second", "B"]);
      expect(replacement).toHaveBeenCalledOnce();
    });
  });

  describe("a replacement failing with stopReplacingSignal's reason once it aborts", () => {
    const bodyFailingOnAbort = (
      signal: AbortSignal,
      { produced = [] as Utf8Bytes[], reason = (): unknown => signal.reason } = {}
    ) =>
      new ReadableStream<Utf8Bytes>({
        start(controller) {
          for (const piece of produced) controller.enqueue(piece);
          signal.addEventListener("abort", () => controller.error(reason()), { once: true });
        }
      });
    const engineReplacingWith = (
      ac: AbortController,
      replacement: LookaheadReplacementFn<string>
    ) =>
      new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        replacement,
        concurrencyStrategy: new SemaphoreStrategy(2),
        stopReplacingSignal: ac.signal
      });

    it("ends a body that fails part way through, after what it produced, and passes the rest of the stream through", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async () =>
        bodyFailingOnAbort(ac.signal, { produced: [utf8("first")] })
      );
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("a{{x}}b");
      await vi.waitFor(() => expect(chunks.join("")).toBe("afirst"));

      ac.abort();
      await engine.write("next");
      await engine.end();

      expect(chunks.join("")).toBe("afirstbnext");
    });

    it("ends a body that fails with an AbortError whose cause is the reason, as Node's stream and http APIs do", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async () =>
        bodyFailingOnAbort(ac.signal, {
          produced: [utf8("first")],
          reason: () => abortErrorCausedBy(ac.signal.reason)
        })
      );
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("a{{x}}b");
      await vi.waitFor(() => expect(chunks.join("")).toBe("afirst"));

      ac.abort();
      await engine.end();

      expect(chunks.join("")).toBe("afirstb");
    });

    it("ends a body that fails with an error wrapping an AbortError whose cause is the reason", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async () =>
        bodyFailingOnAbort(ac.signal, {
          produced: [utf8("first")],
          reason: () => new Error("fragment failed", { cause: abortErrorCausedBy(ac.signal.reason) })
        })
      );
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("a{{x}}b");
      await vi.waitFor(() => expect(chunks.join("")).toBe("afirst"));

      ac.abort();
      await engine.end();

      expect(chunks.join("")).toBe("afirstb");
    });

    it("emits the match verbatim when the replacement's Promise rejects", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, () =>
        new Promise<AsyncIterable<string>>((_, reject) =>
          ac.signal.addEventListener("abort", () => reject(ac.signal.reason), { once: true })
        )
      );
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("a{{x}}b");

      ac.abort();
      await engine.end();

      expect(chunks.join("")).toBe("a{{x}}b");
    });

    it.each([
      { produced: "nothing", pieces: [] },
      { produced: "only a zero-length piece", pieces: [new Uint8Array(0)] },
      { produced: "only a byte order mark, which is dropped", pieces: [utf8("\uFEFF")] }
    ].flatMap((testCase) => sinkKinds.map((kind) => ({ ...testCase, ...kind }))))(
      "emits the match verbatim when its body fails having produced $produced, for $sinkKind",
      async ({ pieces, acceptsBytes }) => {
        const ac = new AbortController();
        const engine = engineReplacingWith(ac, async () => bodyFailingOnAbort(ac.signal, { produced: pieces }));
        const { sink, chunks } = collectEngineSink({ acceptsBytes });
        engine.start(sink);
        await engine.write("a{{x}}b");
        await setImmediate();

        ac.abort();
        await engine.end();

        expect(textOfPieces(chunks)).toBe("a{{x}}b");
      }
    );

    it("emits the match verbatim when an async iterable fails having yielded only an empty string", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async () =>
        (async function* () {
          yield "";
          ac.abort();
          ac.signal.throwIfAborted();
        })()
      );
      const { sink, chunks } = collectEngineSink();

      await runEngine(engine, sink, ["a{{x}}b"]);

      expect(chunks.join("")).toBe("a{{x}}b");
    });

    it("emits a later match verbatim when its body fails having produced nothing, after an earlier body produced output", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async (match) =>
        match === "x" ? asyncIterable("R") : bodyFailingOnAbort(ac.signal)
      );
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("a{{x}}b{{y}}c");
      await vi.waitFor(() => expect(chunks.join("")).toBe("aRb"));

      ac.abort();
      await engine.end();

      expect(chunks.join("")).toBe("aRb{{y}}c");
    });

    it("emits each match verbatim when two bodies already called fail having produced nothing", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async () => bodyFailingOnAbort(ac.signal));
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("a{{x}}b{{y}}c");
      await setImmediate();

      ac.abort();
      await engine.end();

      expect(chunks.join("")).toBe("a{{x}}b{{y}}c");
    });

    it("leaves no rejection unhandled when a later replacement rejects while an earlier one is still being read", async () => {
      const ac = new AbortController();
      const { sink } = collectEngineSink();
      const unhandled = await unhandledRejectionsDuring(async () => {
        const engine = engineReplacingWith(ac, (match) =>
          match === "x"
            ? Promise.resolve(
                (async function* () {
                  yield "first";
                  await setImmediate();
                  await setImmediate();
                  yield "-more";
                })()
              )
            : new Promise<AsyncIterable<string>>((_, reject) =>
                ac.signal.addEventListener("abort", () => reject(ac.signal.reason), { once: true })
              )
        );
        engine.start(sink);
        await engine.write("a{{x}}b{{y}}c");

        ac.abort();
        await engine.end();
      });

      expect(unhandled).toEqual([]);
    });

    it("emits U+FFFD for an incomplete character a body produced before failing", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async () =>
        bodyFailingOnAbort(ac.signal, { produced: [utf8("€").subarray(0, 1)] })
      );
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("a{{x}}b");
      await setImmediate();

      ac.abort();
      await engine.end();

      expect(chunks.join("")).toBe("a�b");
    });

    it("enqueues nothing more once cancelled, when its body then fails with the reason", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async () => bodyFailingOnAbort(ac.signal));
      const { sink, chunks } = collectEngineSink();
      engine.start(sink);
      await engine.write("a{{x}}b");
      await setImmediate();

      engine.cancel();
      ac.abort();
      await setImmediate();

      expect(chunks.join("")).toBe("a");
    });

    it("still errors the stream with any other error the replacement fails with", async () => {
      const ac = new AbortController();
      const engine = engineReplacingWith(ac, async () =>
        bodyFailingOnAbort(ac.signal, { reason: () => new Error("network") })
      );
      const error = vi.fn();
      engine.start({ enqueue: () => {}, error });
      await engine.write("a{{x}}b");
      await setImmediate();

      ac.abort();
      await engine.end().catch(() => {});

      expect(error).toHaveBeenCalledExactlyOnceWith(new Error("network"));
    });

    describe("from a nested() source", () => {
      const untilAbortedBy = (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
      const anchoredEngine = (ac: AbortController, replacement: LookaheadReplacementFn<string>) =>
        new LookaheadTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          concurrencyStrategy: new SemaphoreStrategy(4),
          stopReplacingSignal: ac.signal
        });

      it("ends the child engine, which emits the text already written to it, the partial match it holds and the output of replacements already called", async () => {
        const ac = new AbortController();
        const inner = Promise.withResolvers<AsyncIterable<string>>();
        const innerCalled = Promise.withResolvers<void>();
        const engine = anchoredEngine(ac, async (match) => {
          if (match === "{{y}}") {
            innerCalled.resolve();
            return inner.promise;
          }
          return nested(
            (async function* () {
              yield "hello {{y}} tail {";
              await untilAbortedBy(ac.signal);
              ac.signal.throwIfAborted();
            })()
          );
        });
        const { sink, chunks } = collectEngineSink();
        engine.start(sink);
        await engine.write("a{{x}}b");
        await innerCalled.promise;

        ac.abort();
        inner.resolve(asyncIterable("INNER"));
        await engine.end();

        expect(chunks.join("")).toBe("ahello INNER tail {b");
      });

      it("emits nothing in place of a source that ends without producing anything and without failing", async () => {
        const ac = new AbortController();
        const engine = anchoredEngine(ac, async () => nested(asyncIterable()));
        const { sink, chunks } = collectEngineSink();

        await runEngine(engine, sink, ["a{{x}}b"]);

        expect(chunks.join("")).toBe("ab");
      });

      it("emits the match verbatim when the source fails before producing anything", async () => {
        const ac = new AbortController();
        const engine = anchoredEngine(ac, async () => nested(bodyFailingOnAbort(ac.signal)));
        const { sink, chunks } = collectEngineSink();
        engine.start(sink);
        await engine.write("a{{x}}b");
        await setImmediate();

        ac.abort();
        await engine.end();

        expect(chunks.join("")).toBe("a{{x}}b");
      });

      it("still errors the stream with any other error the source fails with", async () => {
        const ac = new AbortController();
        const engine = anchoredEngine(ac, async () =>
          nested(bodyFailingOnAbort(ac.signal, { produced: [utf8("first")], reason: () => new Error("network") }))
        );
        const error = vi.fn();
        engine.start({ enqueue: () => {}, error });
        await engine.write("a{{x}}b");
        await setImmediate();

        ac.abort();
        await engine.end().catch(() => {});

        expect(error).toHaveBeenCalledExactlyOnceWith(new Error("network"));
      });
    });
  });

  describe("stopping the search once stopReplacingSignal aborts", () => {
    it("stops searching once a replacement aborts the signal while write() waits for room, and flushes the rest of the chunk", async () => {
      const ac = new AbortController();
      const { strategy, counts } = mockSearchStrategy({
        chunk: [
          { isMatch: false, content: "a" },
          { isMatch: true, content: "1", streamIndices: [0, 1] },
          { isMatch: false, content: "b" },
          { isMatch: true, content: "2", streamIndices: [1, 2] },
          { isMatch: true, content: "3", streamIndices: [2, 3] }
        ],
        rest: "REST"
      });
      const replacement = abortingOnFirstCall(ac, async () => asyncIterable("R"));
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal,
        highWaterMark: 1
      });

      await runEngine(engine, sink, ["chunk", "next"]);

      expect(chunks).toEqual(["a", "R", "b", "2", "3REST", "next"]);
      expect(counts.pulled).toBe(4);
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("flushes rather than settles what a strategy holds when the signal aborted before end()", async () => {
      const ac = new AbortController();
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "x", streamIndices: [0, 1] },
        { isMatch: false, content: " " }
      );
      strategy.settle = vi.fn();
      strategy.flush.mockReturnValueOnce("HELD").mockReturnValue("");
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });
      engine.start(sink);

      await engine.write("chunk");
      ac.abort();
      await engine.end();

      expect(chunks).toEqual(["R", " ", "HELD"]);
      expect(strategy.settle).not.toHaveBeenCalled();
    });

    it("stops settling once a replacement aborts the signal while end() waits for room", async () => {
      const ac = new AbortController();
      const { strategy, counts } = mockSearchStrategy({
        settled: [
          { isMatch: true, content: "M1", streamIndices: [0, 2] },
          { isMatch: true, content: "M2", streamIndices: [2, 4] },
          { isMatch: true, content: "M3", streamIndices: [4, 6] },
          { isMatch: true, content: "M4", streamIndices: [6, 8] }
        ],
        rest: "REST"
      });
      const replacement = abortingOnFirstCall(ac, async () => asyncIterable("R"));
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal,
        highWaterMark: 1
      });

      await runEngine(engine, sink, []);

      expect(chunks).toEqual(["R", "M2", "M3", "M4REST"]);
      expect(counts.pulled).toBe(3);
      expect(replacement).toHaveBeenCalledOnce();
    });
  });

  describe("abandonPendingSignal", () => {
    it("emits original match content when signal is aborted before drain reaches an in-flight slot", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const ac = new AbortController();
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");
      ac.abort();
      gate.resolve(asyncIterable("R"));
      await engine.end();
      expect(chunks).toEqual(["M"]);
    });

    it("allows a slot already being drained to complete when signal fires mid-stream", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const ac = new AbortController();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => (async function* () {
          yield "first";
          ac.abort();
          yield "second";
          yield "third";
        })(),
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      await runEngine(engine, sink, ["M"]);
      expect(chunks).toEqual(["first", "second", "third"]);
    });

    it("emits original match content rather than running the nested engine when signal is aborted before drain", async () => {
      let processCount = 0;
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) =>
          processCount++ === 0
            ? [{ isMatch: true, content: "M", streamIndices: [0, 1] }]
            : [{ isMatch: false, content: chunk }] });
      const ac = new AbortController();
      const gate = Promise.withResolvers<void>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement: async () => {
          await gate.promise;
          return nested(asyncIterable("nested-content"));
        },
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");
      ac.abort();
      gate.resolve();
      await engine.end();
      expect(chunks).toEqual(["M"]);
    });

    it("does not store getOriginalContent on slot nodes when no signal is provided", async () => {
      const scheduled: SlotTreeNode[] = [];
      const spy: ConcurrencyStrategy = {
        async acquire(node) {
          scheduled.push(node);
          return () => {};
        }
      };
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: spy
      });
      await runEngine(engine, sink, ["M"]);
      expect((scheduled[0] as IterableSlotNode).getOriginalContent).toBeUndefined();
    });

    it("calls matchToString to derive getOriginalContent stored on each slot node", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      strategy.matchToString.mockReturnValue("raw-M");
      const ac = new AbortController();
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");
      ac.abort();
      gate.resolve(asyncIterable("R"));
      await engine.end();
      expect(strategy.matchToString).toHaveBeenCalledWith("M");
      expect(chunks).toEqual(["raw-M"]);
    });

    it("also bypasses the scan loop — does not call replacement for new matches after signal fires", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const fn = vi.fn(async () => asyncIterable("R"));
      const ac = new AbortController();
      ac.abort();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: fn,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      await runEngine(engine, sink, ["M"]);
      expect(fn).not.toHaveBeenCalled();
      expect(chunks).toEqual(["M"]);
    });

    it("does not wait for replacements that never settle or never yield, and frees their permits", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: true, content: "B", streamIndices: [1, 2] }
      );
      const ac = new AbortController();
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(2);
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async (match) => (match === "A" ? never() : stalledBeforeFirstItem()),
        concurrencyStrategy,
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("AB");
      await setImmediate();

      ac.abort();
      await engine.end();

      expect(chunks).toEqual(["A", "B"]);
      expect(held()).toBe(0);
    });

    it("runs an abandoned generator's finally once its replacement settles", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const ac = new AbortController();
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      let finallyRan = false;
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");
      ac.abort();
      await engine.end();

      gate.resolve(
        (async function* () {
          try {
            yield "R";
          } finally {
            finallyRan = true;
          }
        })()
      );
      await setImmediate();

      expect(finallyRan).toBe(true);
    });

    it("ignores a replacement that rejects after being abandoned", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const ac = new AbortController();
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const { sink, chunks, errors } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");
      ac.abort();
      await engine.end();

      gate.reject(new Error("late"));
      await setImmediate();

      expect(chunks).toEqual(["M"]);
      expect(errors).toEqual([]);
    });
  });

  describe("nested re-scanning", () => {
    it("types a Nested with no type argument as a source of strings, as it was before nested() took bytes", () => {
      expectTypeOf<Nested["source"]>().toEqualTypeOf<AsyncIterable<string>>();
    });

    it("accepts a nested() source typed as yielding strings and bytes from a replacement", () => {
      expectTypeOf(nested(asyncIterable<string | Utf8Bytes>())).toExtend<
        Awaited<ReturnType<LookaheadReplacementFn<string>>>
      >();
    });

    it("spawns a child engine to re-scan nested() content", async () => {
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) => {
          const steps: MatchResult[] = [];
          const re = /\{\{(\w+)\}\}/g;
          let last = 0;
          let regexMatch: RegExpExecArray | null;
          while ((regexMatch = re.exec(chunk)) !== null) {
            if (regexMatch.index > last) {
              steps.push({ isMatch: false, content: chunk.slice(last, regexMatch.index) });
            }
            steps.push({
              isMatch: true,
              content: regexMatch[0],
              streamIndices: [regexMatch.index, re.lastIndex]
            });
            last = re.lastIndex;
          }
          if (last < chunk.length) {
            steps.push({ isMatch: false, content: chunk.slice(last) });
          }
          return steps;
        } });

      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) => {
          if (match === "{{outer}}")
            return nested(asyncIterable("[{{leaf}}]"));
          if (match === "{{leaf}}") return asyncIterable("LEAF");
          return asyncIterable(match);
        }
      });
      await runEngine(engine, sink, ["<{{outer}}>"]);
      expect(chunks.join("")).toBe("<[LEAF]>");
    });

    it("attaches nested match slots to the parent slot in the slot tree", async () => {
      const scheduled: SlotTreeNode[] = [];
      const spy: ConcurrencyStrategy = {
        async acquire(node) {
          scheduled.push(node);
          return () => {};
        }
      };
      let callCount = 0;
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) => [
        {
          isMatch: true,
          content: callCount++ === 0 ? "outer" : "inner",
          streamIndices: [0, chunk.length]
        }
      ] });

      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        concurrencyStrategy: spy,
        replacement: async (match) => {
          if (match === "outer") return nested(asyncIterable("inner"));
          return asyncIterable("LEAF");
        }
      });
      await runEngine(engine, sink, ["outer"]);

      expect(scheduled).toHaveLength(2);
      expect(scheduled[0].parent).toBeNull();
      expect(scheduled[1].parent).toBe(scheduled[0]);
    });

    it("wakes the consumer when a child enqueue arrives after the consumer has begun waiting", async () => {
      const gate = Promise.withResolvers<void>();
      async function* nestedSource(): AsyncGenerator<string> {
        yield "first ";
        await gate.promise;
        yield "second";
      }

      let callCount = 0;
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) =>
        callCount++ === 0
          ? [{ isMatch: true, content: "M", streamIndices: [0, 1] }]
          : [{ isMatch: false, content: chunk }] });

      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        concurrencyStrategy: new SemaphoreStrategy(2),
        replacement: async () => nested(nestedSource())
      });
      engine.start(sink);
      await engine.write("M");

      await vi.waitFor(() => expect(chunks.join("")).toBe("first "));

      gate.resolve();
      await engine.end();
      expect(chunks.join("")).toBe("first second");
    });

    it.each<[string, (engine: LookaheadTransformEngine<object, string>, abandon: AbortController) => void]>([
      ["cancel()", (engine) => engine.cancel()],
      ["abandonPendingSignal", (_engine, abandon) => abandon.abort()]
    ])("closes the source of a nested() replacement abandoned by %s", async (_, abandonSlot) => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const abandon = new AbortController();
      const gate = Promise.withResolvers<ReturnType<typeof nested>>();
      let sourceCancelled = false;
      const source = new ReadableStream<string>({
        pull(controller) {
          controller.enqueue("nested");
        },
        cancel() {
          sourceCancelled = true;
        }
      });
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: abandon.signal
      });
      engine.start(collectEngineSink().sink);
      await engine.write("M");

      abandonSlot(engine, abandon);
      await engine.end();
      gate.resolve(nested(source));
      await setImmediate();

      expect(sourceCancelled).toBe(true);
    });

    it("surfaces an error thrown while iterating the nested source", async () => {
      async function* failingSource(): AsyncGenerator<string> {
        yield "ok ";
        throw new Error("source failed");
      }
      let callCount = 0;
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) =>
        callCount++ === 0
          ? [{ isMatch: true, content: "M", streamIndices: [0, 1] }]
          : [{ isMatch: false, content: chunk }] });

      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        concurrencyStrategy: new SemaphoreStrategy(2),
        replacement: async () => nested(failingSource())
      });
      engine.start(sink);
      await engine.write("M");
      await expect(engine.end()).rejects.toThrow("source failed");
    });

    it("surfaces a child engine failure via the nested bridge", async () => {
      let callCount = 0;
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) => [
        {
          isMatch: true,
          content: callCount++ === 0 ? "outer" : "inner",
          streamIndices: [0, chunk.length]
        }
      ] });

      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        concurrencyStrategy: new SemaphoreStrategy(2),
        replacement: async (match) => {
          if (match === "outer") return nested(asyncIterable("inner"));
          throw new Error("inner boom");
        }
      });
      engine.start(sink);
      await engine.write("outer");
      await expect(engine.end()).rejects.toThrow("inner boom");
    });

    it("supports deeper (>1 level) nesting", async () => {
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) => [
          { isMatch: true, content: chunk, streamIndices: [0, chunk.length] }
        ] });

      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) => {
          if (match === "L0") return nested(asyncIterable("L1"));
          if (match === "L1") return nested(asyncIterable("L2"));
          if (match === "L2") return asyncIterable("LEAF");
          return asyncIterable(match);
        }
      });
      await runEngine(engine, sink, ["L0"]);
      expect(chunks.join("")).toBe("LEAF");
    });
  });

  describe("cancel()", () => {
    it("write() called after cancel() returns immediately without scanning", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const fn = vi.fn(async () => asyncIterable("R"));
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: fn,
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);
      engine.cancel();
      await engine.write("M");
      await engine.end();
      expect(fn).not.toHaveBeenCalled();
      expect(chunks).toEqual([]);
    });

    it("end() after cancel() resolves without hanging", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "hello" }
      );
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable(""),
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);
      await engine.write("hello");
      engine.cancel();
      await expect(engine.end()).resolves.toBeUndefined();
    });

    it("handles a replacement rejection when next() cancels synchronously", async () => {
      let engine!: LookaheadTransformEngine<object, string>;
      const replacement: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              engine.cancel();
              throw new Error("replacement failed during cancellation");
            },
            return() {
              return Promise.resolve({ done: true, value: undefined });
            }
          };
        }
      };
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "M",
        streamIndices: [0, 1]
      });
      const { sink } = collectEngineSink();
      engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => replacement,
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);

      const unhandled = await unhandledRejectionsDuring(async () => {
        await engine.write("M");
        await expect(engine.end()).resolves.toBeUndefined();
      });

      expect(unhandled).toEqual([]);
    });

    it("cancel() while write() is suspended on a full queue unblocks write()", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] as [number, number] },
        { isMatch: true, content: "M", streamIndices: [1, 2] as [number, number] },
        { isMatch: true, content: "M", streamIndices: [2, 3] as [number, number] }
      );
      // First replacement holds the drain loop; second and third fill/overflow buffer
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      let callCount = 0;
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => (callCount++ === 0 ? gate.promise : asyncIterable("")),
        concurrencyStrategy: new SemaphoreStrategy(4),
        highWaterMark: 1
      });
      engine.start(sink);

      // M1 → drain loop (blocked on gate), M2 → fills buffer, M3 → write() blocks
      const writePromise = engine.write("MMM");
      await setImmediate();
      expect(callCount).toBe(3);

      engine.cancel();
      gate.resolve(asyncIterable(""));

      await expect(writePromise).resolves.toBeUndefined();
      await engine.end();
    });

    it("cancel() while write() is suspended on a full queue stops scanning the rest of the chunk", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] },
        { isMatch: true, content: "M", streamIndices: [2, 3] },
        { isMatch: true, content: "M", streamIndices: [3, 4] }
      );
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const fn = vi.fn(async () => (fn.mock.calls.length === 1 ? gate.promise : asyncIterable("")));
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: fn,
        concurrencyStrategy: new SemaphoreStrategy(4),
        highWaterMark: 1
      });
      engine.start(sink);

      const writePromise = engine.write("MMMM");
      await setImmediate();

      engine.cancel();
      gate.resolve(asyncIterable(""));

      await expect(writePromise).resolves.toBeUndefined();
      await engine.end();
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("cancel() while the stop-replacing flush is suspended on a full queue does not pass the chunk through", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      strategy.flush.mockReturnValue("ABC");
      const ac = new AbortController();
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        highWaterMark: 1,
        stopReplacingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");
      ac.abort();

      const writePromise = engine.write("X");

      engine.cancel();
      gate.resolve(asyncIterable(""));

      await expect(writePromise).resolves.toBeUndefined();
      await engine.end();
      expect(chunks).toEqual([]);
    });

    it("cancel() while write() is suspended on a full queue releases every acquired concurrency slot", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] },
        { isMatch: true, content: "M", streamIndices: [2, 3] }
      );
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      let callCount = 0;
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(4);
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => (callCount++ === 0 ? gate.promise : asyncIterable("")),
        concurrencyStrategy,
        highWaterMark: 1
      });
      engine.start(sink);

      const writePromise = engine.write("MMM");
      await setImmediate();
      expect(held()).toBe(3);

      engine.cancel();
      gate.resolve(asyncIterable(""));
      await writePromise;
      await engine.end();

      expect(held()).toBe(0);
    });

    it("cancel() discards buffered text slots — does not emit them to the sink", async () => {
      const gate = Promise.withResolvers<void>();
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: false, content: "after" }
      );
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => {
          await gate.promise;
          return asyncIterable("R");
        },
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);
      await engine.write("Mafter");
      // "after" is buffered; the match slot is still awaiting the gate
      engine.cancel();
      gate.resolve();
      await engine.end();
      // Neither the replacement nor the buffered text should appear
      expect(chunks).toEqual([]);
    });

    it("cancel() calls iter.return() on pending iterable slots to free resources", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      let returnCalled = false;
      const gate = Promise.withResolvers<void>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => {
          await gate.promise;
          return (async function* () {
            try {
              yield "chunk";
            } finally {
              returnCalled = true;
            }
          })();
        },
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);
      await engine.write("M");

      engine.cancel();
      gate.resolve();
      await engine.end();
      await setImmediate();

      expect(returnCalled).toBe(true);
      expect(chunks).toEqual([]);
    });

    it.each<[string, () => Promise<AsyncIterable<string>>]>([
      ["whose promise never settles", () => never()],
      ["whose first item never arrives", async () => stalledBeforeFirstItem()]
    ])("cancel() does not wait for, and frees the permit of, a replacement %s", async (_, replacement) => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(1);
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy
      });
      engine.start(sink);
      await engine.write("M");
      await setImmediate();

      engine.cancel();
      await expect(engine.end()).resolves.toBeUndefined();
      expect(held()).toBe(0);
    });

    it("cancel() mid-stream stops output without waiting for the next item", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const secondItem = Promise.withResolvers<void>();
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(1);
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () =>
          (async function* () {
            yield "first";
            await secondItem.promise;
            yield "second";
          })(),
        concurrencyStrategy
      });
      engine.start(sink);
      await engine.write("M");
      await setImmediate();
      expect(chunks).toEqual(["first"]);

      engine.cancel();
      await expect(engine.end()).resolves.toBeUndefined();
      expect(held()).toBe(0);
      secondItem.resolve();
      await setImmediate();
      expect(chunks).toEqual(["first"]);
    });

    it("does not start or render a queued replacement after it acquires a permit following cancel()", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] }
      );
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(1);
      let replacementCalls = 0;
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: () => {
          replacementCalls++;
          return new Promise(() => {});
        },
        concurrencyStrategy,
        stopReplacingSignal: new AbortController().signal,
        highWaterMark: 2
      });
      engine.start(sink);

      const writePromise = engine.write("MM");
      await setImmediate();
      expect(replacementCalls).toBe(1);

      engine.cancel();
      await writePromise;
      await engine.end();
      await setImmediate();

      expect(replacementCalls).toBe(1);
      expect(held()).toBe(0);
      expect(chunks).toEqual([]);
      expect(strategy.matchToString).not.toHaveBeenCalled();
    });

    it("retains a permit for a replacement already streaming when pending slots are abandoned", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] }
      );
      const nextGate = Promise.withResolvers<void>();
      const abandon = new AbortController();
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(1);
      let replacementCalls = 0;
      let firstStarted = false;
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => {
          replacementCalls++;
          if (replacementCalls > 1) return asyncIterable("second");
          return (async function* () {
            firstStarted = true;
            await nextGate.promise;
            yield "first";
          })();
        },
        concurrencyStrategy,
        abandonPendingSignal: abandon.signal,
        highWaterMark: 2
      });
      engine.start(sink);

      const writePromise = engine.write("MM");
      await setImmediate();
      expect(firstStarted).toBe(true);
      expect(replacementCalls).toBe(1);

      abandon.abort();
      await setImmediate();
      expect(replacementCalls).toBe(1);
      expect(held()).toBe(1);

      nextGate.resolve();
      await writePromise;
      await engine.end();

      expect(replacementCalls).toBe(1);
      expect(held()).toBe(0);
      expect(chunks.join("")).toBe("firstM");
    });

    it("cancel() does not emit original text even when abandonPendingSignal is configured", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      strategy.matchToString.mockReturnValue("original-M");
      const ac = new AbortController();
      const gate = Promise.withResolvers<AsyncIterable<string>>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");

      // cancel() rather than ac.abort() — original text must not be emitted
      engine.cancel();
      gate.resolve(asyncIterable("R"));
      await engine.end();

      expect(chunks).toEqual([]);
    });

    it("cancel() propagates through to nested engines via the composed abandon signal", async () => {
      let processCount = 0;
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) =>
          processCount++ === 0
            ? [{ isMatch: true, content: "M", streamIndices: [0, 1] }]
            : [{ isMatch: false, content: chunk }] });
      const gate = Promise.withResolvers<void>();
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement: async () => {
          await gate.promise;
          return nested(asyncIterable("nested-content"));
        },
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);
      await engine.write("M");

      engine.cancel();
      gate.resolve();
      await engine.end();

      expect(chunks).toEqual([]);
    });

    it("stops pulling a nested source after cancel()", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "match",
        streamIndices: [0, 5]
      });
      let pulls = 0;
      const endless = (async function* () {
        for (;;) {
          pulls++;
          await setImmediate();
          yield "x";
        }
      })();
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async (_match, { depth }) =>
          depth === 0 ? nested(endless) : asyncIterable(""),
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);
      await engine.write("outer");
      await setImmediate();

      engine.cancel();
      await engine.end();
      await setImmediate();
      const pullsAfterCancel = pulls;
      for (let i = 0; i < 5; i++) await setImmediate();

      expect(pulls).toBe(pullsAfterCancel);
    });

    it("cancel() frees the permit of a nested child replacement stalled mid-stream", async () => {
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(2);
      const engine = new LookaheadTransformEngine({
        searchStrategy: matchEveryChunk(),
        replacement: async (_match, { depth }) =>
          depth === 0
            ? nested((async function* () {
              yield "inner";
              await never<void>();
            })())
            : stalledAfterFirstItem(),
        concurrencyStrategy
      });
      engine.start(collectEngineSink().sink);
      await engine.write("outer");
      await setImmediate();
      expect(held()).toBe(1);

      engine.cancel();
      await engine.end();

      expect(held()).toBe(0);
    });

    it("does not pull a nested source again after cancel() while a child write is pending", async () => {
      let pulls = 0;
      const source = (async function* () {
        for (;;) {
          pulls++;
          yield "x";
        }
      })();
      const engine = new LookaheadTransformEngine({
        searchStrategy: matchEveryChunk(),
        replacement: async (_match, { depth }) => (depth === 0 ? nested(source) : never()),
        concurrencyStrategy: new SemaphoreStrategy(4),
        highWaterMark: 1
      });
      engine.start(collectEngineSink().sink);
      await engine.write("outer");
      await setImmediate();
      const pullsBeforeCancel = pulls;

      engine.cancel();
      await engine.end();
      await setImmediate();

      expect(pulls).toBe(pullsBeforeCancel);
    });

    it("does not pull a nested source again after its child engine fails during a write", async () => {
      let pulls = 0;
      const source = (async function* () {
        for (;;) {
          pulls++;
          yield "x";
        }
      })();
      const childReplacement = Promise.withResolvers<AsyncIterable<string>>();
      const engine = new LookaheadTransformEngine({
        searchStrategy: matchEveryChunk(),
        replacement: async (_match, { depth }) =>
          depth === 0 ? nested(source) : childReplacement.promise,
        concurrencyStrategy: new SemaphoreStrategy(8),
        highWaterMark: 1
      });
      engine.start(collectEngineSink().sink);
      await engine.write("outer");
      await setImmediate();
      const pullsBeforeFailure = pulls;

      childReplacement.reject(new Error("child failed"));
      await expect(engine.end()).rejects.toThrow("child failed");
      await setImmediate();

      expect(pulls).toBe(pullsBeforeFailure);
    });

    it("cancels a child engine when reading its nested source fails", async () => {
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) =>
          chunk === "outer" || chunk === "inner"
            ? [{ isMatch: true, content: chunk, streamIndices: [0, chunk.length] }]
            : [] });
      const { strategy: concurrencyStrategy, held } = heldSlotCounter(2);
      async function* source() {
        yield "inner";
        throw new Error("nested source failed");
      }
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async (_match, { depth }) =>
          depth === 0 ? nested(source()) : stalledBeforeFirstItem(),
        concurrencyStrategy
      });
      engine.start(sink);

      await engine.write("outer");
      await expect(engine.end()).rejects.toThrow("nested source failed");

      expect(held()).toBe(0);
    });

    it("rejects end() with a child engine failure while its nested source is still being read", async () => {
      const engine = new LookaheadTransformEngine({
        searchStrategy: matchEveryChunk(),
        replacement: async (_match, { depth }) => {
          if (depth > 0) throw new Error("child failed");
          return nested((async function* () {
            yield "a";
            await setImmediate();
            yield "b";
          })());
        },
        concurrencyStrategy: new SemaphoreStrategy(2)
      });
      engine.start(collectEngineSink().sink);
      await engine.write("outer");

      await expect(engine.end()).rejects.toThrow("child failed");
      await setImmediate();
    });

    it("closes a nested source when the child engine fails while writing it", async () => {
      let closed = false;
      const { strategy } = mockSearchStrategy({ chunk: (chunk: string) => {
          if (chunk === "outer") return [{ isMatch: true, content: "outer", streamIndices: [0, 5] }];
          throw new Error("child write failed");
        } });
      async function* source() {
        try {
          yield "nested";
          yield "unread";
        } finally {
          closed = true;
        }
      }
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async (_match, context) =>
          context.depth === 0 ? nested(source()) : asyncIterable("child"),
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      engine.start(sink);

      await engine.write("outer");
      await expect(engine.end()).rejects.toThrow("child write failed");

      expect(closed).toBe(true);
    });
  });

  describe("depth in ReplacementContext", () => {
    function matchAllStrategy() {
      return mockSearchStrategy({
    chunk: (chunk: string) => [{ isMatch: true, content: chunk, streamIndices: [0, chunk.length] }]
  }).strategy;
    }

    it("passes depth 0 for top-level matches", async () => {
      const depths: number[] = [];
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: matchAllStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (_match, ctx) => {
          depths.push(ctx.depth);
          return asyncIterable("x");
        }
      });
      await runEngine(engine, sink, ["A", "B"]);
      expect(depths).toEqual([0, 0]);
    });

    it("passes depth 1 for matches inside a nested() replacement", async () => {
      const depths: number[] = [];
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: matchAllStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (_match, ctx) => {
          depths.push(ctx.depth);
          if (ctx.depth === 0) return nested(asyncIterable("inner"));
          return asyncIterable("leaf");
        }
      });
      await runEngine(engine, sink, ["outer"]);
      expect(depths).toEqual([0, 1]);
    });

    it("increments depth by 1 per nesting level", async () => {
      const depths: number[] = [];
      const { sink } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: matchAllStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (_match, ctx) => {
          depths.push(ctx.depth);
          if (ctx.depth === 0) return nested(asyncIterable("d1"));
          if (ctx.depth === 1) return nested(asyncIterable("d2"));
          return asyncIterable("leaf");
        }
      });
      await runEngine(engine, sink, ["d0"]);
      expect(depths).toEqual([0, 1, 2]);
    });
  });

  describe("byte replacements", () => {
    it("passes each byte piece to a sink that accepts bytes as it is, in order with the text around it", async () => {
      const first = utf8("€");
      const last = utf8("c");
      const { sink, chunks } = collectEngineSink({ acceptsBytes: true });
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async () => asyncIterable<string | Utf8Bytes>(first, "b", last)
      });
      await runEngine(engine, sink, ["<{{x}}>"]);

      expect(chunks).toHaveLength(5);
      expect(chunks[0]).toBe("<");
      expect(chunks[1]).toBe(first);
      expect(chunks[2]).toBe("b");
      expect(chunks[3]).toBe(last);
      expect(chunks[4]).toBe(">");
    });

    it("accepts replacements typed as yielding any Uint8Array, such as Node Buffers, plain or nested()", async () => {
      const buffersOf = async function* (text: string): AsyncGenerator<Uint8Array> {
        yield Buffer.from(text);
      };
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) => (match === "outer" ? nested(buffersOf("<{{inner}}>")) : buffersOf("€"))
      });
      await runEngine(engine, sink, ["{{outer}}"]);

      expect(chunks.join("")).toBe("<€>");
    });

    it("drops a byte order mark at the start of a replacement's bytes, plain or nested()", async () => {
      const withByteOrderMark = (text: string) => asyncIterable(utf8(`\uFEFF${text}`));
      const { sink, chunks } = collectEngineSink();
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) =>
          match === "outer" ? nested(withByteOrderMark("<{{inner}}>")) : withByteOrderMark("i")
      });
      await runEngine(engine, sink, ["a{{outer}}"]);

      expect(chunks.join("")).toBe("a<i>");
    });

    it.each(sinkKinds)("reads bytes from another realm as bytes, plain or nested(), for $sinkKind, as a fetch body's chunks are by code run in a vm context, such as a Jest test environment", async ({ acceptsBytes }) => {
      const { sink, chunks } = collectEngineSink({ acceptsBytes });
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) =>
          match === "outer"
            ? nested(asyncIterable(foreignRealmUtf8("<{{inner}}>")))
            : asyncIterable(foreignRealmUtf8("€"))
      });
      await runEngine(engine, sink, ["a{{outer}}"]);

      expect(textOfPieces(chunks)).toBe("a<€>");
    });

    it.each(sinkKinds)("keeps a character whole across an empty string piece, which doesn't end the bytes around it, plain or nested(), for $sinkKind", async ({ acceptsBytes }) => {
      const euroAround = (...rest: string[]) =>
        asyncIterable<string | Utf8Bytes>(Uint8Array.of(0xe2), "", Uint8Array.of(0x82, 0xac), ...rest);
      const { sink, chunks } = collectEngineSink({ acceptsBytes });
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) => (match === "outer" ? nested(euroAround("{{inner}}")) : euroAround())
      });
      await runEngine(engine, sink, ["a{{outer}}"]);

      expect(textOfPieces(chunks)).toBe("a€€");
    });

    it.each(sinkKinds)("decodes a replacement that ends part way through a character as U+FFFD at its own end, rather than completing it with the next replacement's bytes, for $sinkKind", async ({ acceptsBytes }) => {
      const { sink, chunks } = collectEngineSink({ acceptsBytes });
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) => asyncIterable(match === "a" ? Uint8Array.of(0xe2, 0x82) : Uint8Array.of(0xac))
      });
      await runEngine(engine, sink, ["{{a}}{{b}}"]);

      expect(textOfPieces(chunks)).toBe("\uFFFD\uFFFD");
    });

    it.each(sinkKinds)("reads bytes in a resizable ArrayBuffer, plain or nested(), though browsers' TextDecoder refuses them, for $sinkKind", async ({ acceptsBytes }) => {
      refuseResizableBuffersInTextDecoder();
      const { sink, chunks } = collectEngineSink({ acceptsBytes });
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) =>
          match === "outer"
            ? nested(asyncIterable(inResizableArrayBuffer(utf8("<{{inner}}>"))))
            : asyncIterable(inResizableArrayBuffer(utf8("€")))
      });
      await runEngine(engine, sink, ["{{outer}}"]);

      expect(textOfPieces(chunks)).toBe("<€>");
    });

    it("enqueues nothing once a sink that accepts bytes cancels it on receiving the U+FFFD that ends a run of bytes before a string piece", async () => {
      const afterCancel: (string | Utf8Bytes)[] = [];
      let cancelled = false;
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async () => asyncIterable<string | Utf8Bytes>(Uint8Array.of(0xe2), "x")
      });
      await runEngine(
        engine,
        {
          enqueue: (chunk: string | Utf8Bytes) => {
            if (cancelled) afterCancel.push(chunk);
            else if (typeof chunk === "string" && chunk.includes("\uFFFD")) {
              cancelled = true;
              engine.cancel();
            }
          },
          error: () => {},
          acceptsBytes: true
        },
        ["<{{x}}>"]
      );

      expect(cancelled).toBe(true);
      expect(afterCancel).toEqual([]);
    });

    it("keeps byte slots in stream order when a later replacement settles first", async () => {
      const first = Promise.withResolvers<void>();
      const { sink, chunks } = collectEngineSink({ acceptsBytes: true });
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) => {
          if (match === "a") await first.promise;
          else first.resolve();
          return asyncIterable(utf8(match === "a" ? "A€" : "B€"));
        }
      });
      await runEngine(engine, sink, ["{{a}}-{{b}}"]);

      expect(textOfPieces(chunks)).toBe("A€-B€");
    });

    describe.each(sinkKinds)("with $sinkKind", ({ acceptsBytes }) => {
      it("decodes nested() byte content to search it, at a depth over 1, keeping a character split across its pieces whole", async () => {
        const { sink, chunks } = collectEngineSink({ acceptsBytes });
        const [startOfEuro, restOfEuro] = [utf8("[€").subarray(0, 2), utf8("€{{mid}}]").subarray(1)];
        const engine = new LookaheadTransformEngine({
          searchStrategy: braceStrategy(),
          concurrencyStrategy: new SemaphoreStrategy(4),
          replacement: async (match, { depth }) => {
            if (match === "outer") return nested(asyncIterable(startOfEuro, restOfEuro));
            if (match === "mid") return nested(asyncIterable(utf8("({{leaf}})")));
            return asyncIterable(utf8(`${match}@${depth}`));
          }
        });
        await runEngine(engine, sink, ["<{{outer}}>"]);

        expect(textOfPieces(chunks)).toBe("<[€(leaf@2)]>");
      });

      it("decodes nested() byte content that ends part way through a character as U+FFFD, before the child engine ends", async () => {
        const { sink, chunks } = collectEngineSink({ acceptsBytes });
        const engine = new LookaheadTransformEngine({
          searchStrategy: braceStrategy(),
          concurrencyStrategy: new SemaphoreStrategy(4),
          replacement: async () => nested(asyncIterable(Uint8Array.of(0x61, 0xe2, 0x82)))
        });
        await runEngine(engine, sink, ["<{{x}}>"]);

        expect(textOfPieces(chunks)).toBe("<a\uFFFD>");
      });

      it("keeps a byte order mark in a replacement's bytes within nested() content once it is past their start, as it does any other character", async () => {
        const { sink, chunks } = collectEngineSink({ acceptsBytes });
        const engine = new LookaheadTransformEngine({
          searchStrategy: braceStrategy(),
          concurrencyStrategy: new SemaphoreStrategy(4),
          replacement: async (match) =>
            match === "outer"
              ? nested(asyncIterable("<{{inner}}>"))
              : asyncIterable(utf8("\uFEFF"), utf8("\uFEFFa"))
        });
        await runEngine(engine, sink, ["{{outer}}"]);

        expect(textOfPieces(chunks)).toBe("<\uFEFFa>");
      });
    });

    it.each(sinkKinds)("decodes a nested replacement that ends part way through a character as U+FFFD at its own end, rather than completing it with the next one's bytes, for $sinkKind", async ({ acceptsBytes }) => {
      const { sink, chunks } = collectEngineSink({ acceptsBytes });
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) => {
          if (match === "outer") return nested(asyncIterable("{{a}}{{b}}"));
          return asyncIterable(match === "a" ? Uint8Array.of(0xe2, 0x82) : Uint8Array.of(0xac));
        }
      });
      await runEngine(engine, sink, ["{{outer}}"]);

      expect(textOfPieces(chunks)).toBe("\uFFFD\uFFFD");
    });

    it("passes the bytes of a nested replacement to a sink that accepts bytes undecoded", async () => {
      const leaf = utf8("€");
      const { sink, chunks } = collectEngineSink({ acceptsBytes: true });
      const engine = new LookaheadTransformEngine({
        searchStrategy: braceStrategy(),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) =>
          match === "outer" ? nested(asyncIterable("[{{leaf}}]")) : asyncIterable(leaf)
      });
      await runEngine(engine, sink, ["{{outer}}"]);

      expect(chunks).toContainEqual(leaf);
    });
  });
});
