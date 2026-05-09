import { describe, it, expect, vi } from "vitest";
import { AsyncLookaheadTransformEngine } from "./engine.ts";
import { SemaphoreStrategy } from "./concurrency-strategy/semaphore-strategy.ts";
import type { ConcurrencyStrategy } from "./concurrency-strategy/types.ts";
import type { SlotTreeNode, IterableSlotNode } from "./slot-tree/types.ts";
import { nested } from "./nested.ts";
import type { EngineSink } from "../types.ts";
import {
  asyncIterable,
  deferred,
  mockSearchStrategyFactory,
  settleMicrotasks
} from "../../../test/utilities.ts";

function collectingSink(): {
  sink: EngineSink;
  chunks: string[];
  errors: unknown[];
} {
  const chunks: string[] = [];
  const errors: unknown[] = [];
  return {
    sink: {
      enqueue: (chunk) => chunks.push(chunk),
      error: (err) => errors.push(err)
    },
    chunks,
    errors
  };
}

async function runEngine(
  engine: AsyncLookaheadTransformEngine<object, string>,
  sink: EngineSink,
  inputs: string[]
): Promise<void> {
  engine.start(sink);
  for (const input of inputs) await engine.write(input);
  await engine.end();
}

describe("AsyncLookaheadTransformEngine", () => {
  describe("text slots", () => {
    it("emits non-match text directly to the sink", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "hello " },
        { isMatch: false, content: "world" }
      );
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable(""),
        concurrencyStrategy: new SemaphoreStrategy(1)
      });
      await runEngine(engine, sink, ["only"]);
      expect(chunks).toEqual(["only"]);
    });
  });

  describe("match slots", () => {
    it("emits replacement iterable chunks in place of each match", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "pre " },
        { isMatch: true, content: "M", streamIndices: [4, 5] },
        { isMatch: false, content: " post" }
      );
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      const gateA = deferred<AsyncIterable<string>>();
      const gateB = deferred<AsyncIterable<string>>();
      let callCount = 0;

      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () =>
          callCount++ === 0 ? gateA.promise : gateB.promise,
        concurrencyStrategy: new SemaphoreStrategy(2)
      });
      engine.start(sink);
      await engine.write("A-B");

      // Later match resolves first.
      gateB.resolve(asyncIterable("b"));
      await settleMicrotasks(5);
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
      const firstGate = deferred<AsyncIterable<string>>();
      const started: number[] = [];
      let callCount = 0;

      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      await settleMicrotasks(5);
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

      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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

  describe("backpressure", () => {
    it("suspends write() once highWaterMark buffered slots are reached", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] },
        { isMatch: true, content: "M", streamIndices: [1, 2] },
        { isMatch: true, content: "M", streamIndices: [2, 3] }
      );
      const gates = [0, 1, 2].map(() => deferred<AsyncIterable<string>>());
      let callCount = 0;

      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      await settleMicrotasks(10);
      expect(writeResolved).toBe(false);

      gates[0].resolve(asyncIterable("a"));
      await writePromise;
      expect(writeResolved).toBe(true);

      gates[1].resolve(asyncIterable("b"));
      gates[2].resolve(asyncIterable("c"));
      await engine.end();
    });
  });

  describe("error propagation", () => {
    it("forwards a replacement failure to sink.error and rejects end()", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "M",
        streamIndices: [0, 1]
      });
      const { sink, errors } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
  });

  describe("stopReplacingSignal", () => {
    it("passes chunk through without calling replacement when already aborted", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const fn = vi.fn(async () => asyncIterable("R"));
      const ac = new AbortController();
      ac.abort();
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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

    it("calls flush() exactly once across multiple writes and end() when the signal is pre-aborted", async () => {
      const strategy = mockSearchStrategyFactory({ isMatch: false, content: "" });
      strategy.flush.mockReturnValue("BUF");
      const ac = new AbortController();
      ac.abort();
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("X");
      await engine.write("Y");
      await engine.end();
      expect(strategy.flush).toHaveBeenCalledOnce();
      expect(chunks).toEqual(["BUF", "X", "Y"]);
    });

    it("does not call replacement for matches scanned after signal aborts mid-chunk", async () => {
      const ac = new AbortController();
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          yield { isMatch: true, content: "A", streamIndices: [0, 1] as [number, number] };
          ac.abort();
          yield { isMatch: true, content: "B", streamIndices: [1, 2] as [number, number] };
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((match: string) => match)
      };
      const fn = vi.fn(async () => asyncIterable("R"));
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement: fn,
        concurrencyStrategy: new SemaphoreStrategy(2),
        stopReplacingSignal: ac.signal
      });
      await runEngine(engine, sink, ["AB"]);
      // "A" scheduled before abort — replacement runs, "R" emitted.
      // "B" scanned after abort — pushed as text slot via matchToString, no replacement call.
      expect(chunks).toEqual(["R", "B"]);
      expect(fn).toHaveBeenCalledOnce();
    });

    it("uses matchToString to convert mid-chunk match text when emitting verbatim", async () => {
      const ac = new AbortController();
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          ac.abort();
          yield { isMatch: true, content: "M", streamIndices: [0, 1] as [number, number] };
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockReturnValue("raw-M")
      };
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        replacement: async () => asyncIterable("R"),
        concurrencyStrategy: new SemaphoreStrategy(1),
        stopReplacingSignal: ac.signal
      });
      await runEngine(engine, sink, ["M"]);
      expect(strategy.matchToString).toHaveBeenCalledWith("M");
      expect(chunks).toEqual(["raw-M"]);
    });
  });

  describe("abandonPendingSignal", () => {
    it("emits original match content when signal is aborted before drain reaches an in-flight slot", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "M", streamIndices: [0, 1] }
      );
      const ac = new AbortController();
      const gate = deferred<AsyncIterable<string>>();
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");
      await settleMicrotasks(5);
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
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      const strategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* (chunk: string) {
          if (processCount++ === 0) {
            yield { isMatch: true, content: "M", streamIndices: [0, 1] as [number, number] };
          } else {
            yield { isMatch: false, content: chunk };
          }
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((match: string) => match)
      };
      const ac = new AbortController();
      const gate = deferred<void>();
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
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
      await settleMicrotasks(5);
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
      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
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
      const gate = deferred<AsyncIterable<string>>();
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => gate.promise,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      engine.start(sink);
      await engine.write("M");
      await settleMicrotasks(5);
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
      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: fn,
        concurrencyStrategy: new SemaphoreStrategy(1),
        abandonPendingSignal: ac.signal
      });
      await runEngine(engine, sink, ["M"]);
      expect(fn).not.toHaveBeenCalled();
      expect(chunks).toEqual(["M"]);
    });
  });

  describe("nested re-scanning", () => {
    it("spawns a child engine to re-scan nested() content", async () => {
      const strategy = {
        createState: () => ({}),
        processChunk: vi.fn().mockImplementation(function* (chunk: string) {
          const re = /\{\{(\w+)\}\}/g;
          let last = 0;
          let regexMatch: RegExpExecArray | null;
          while ((regexMatch = re.exec(chunk)) !== null) {
            if (regexMatch.index > last) {
              yield { isMatch: false, content: chunk.slice(last, regexMatch.index) };
            }
            yield {
              isMatch: true,
              content: regexMatch[0],
              streamIndices: [regexMatch.index, re.lastIndex] as [number, number]
            };
            last = re.lastIndex;
          }
          if (last < chunk.length) {
            yield { isMatch: false, content: chunk.slice(last) };
          }
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((match: string) => match)
      };

      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
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
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "outer",
        streamIndices: [0, 5]
      });
      let callCount = 0;
      strategy.processChunk.mockImplementation(function* (chunk: string) {
        if (callCount++ === 0) {
          yield {
            isMatch: true,
            content: "outer",
            streamIndices: [0, chunk.length]
          };
        } else {
          yield {
            isMatch: true,
            content: "inner",
            streamIndices: [0, chunk.length]
          };
        }
      });

      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
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
      const gate = deferred<void>();
      async function* nestedSource(): AsyncGenerator<string> {
        yield "first ";
        await gate.promise;
        yield "second";
      }

      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "M",
        streamIndices: [0, 1]
      });
      let callCount = 0;
      strategy.processChunk.mockImplementation(function* (chunk: string) {
        if (callCount++ === 0) {
          yield { isMatch: true, content: "M", streamIndices: [0, 1] };
        } else {
          yield { isMatch: false, content: chunk };
        }
      });

      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
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

    it("surfaces an error thrown while iterating the nested source", async () => {
      async function* failingSource(): AsyncGenerator<string> {
        yield "ok ";
        throw new Error("source failed");
      }
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "M",
        streamIndices: [0, 1]
      });
      let callCount = 0;
      strategy.processChunk.mockImplementation(function* (chunk: string) {
        if (callCount++ === 0) {
          yield { isMatch: true, content: "M", streamIndices: [0, 1] };
        } else {
          yield { isMatch: false, content: chunk };
        }
      });

      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
        searchStrategy: strategy,
        concurrencyStrategy: new SemaphoreStrategy(2),
        replacement: async () => nested(failingSource())
      });
      engine.start(sink);
      await engine.write("M");
      await expect(engine.end()).rejects.toThrow("source failed");
    });

    it("surfaces a child engine failure via the nested bridge", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "outer",
        streamIndices: [0, 5]
      });
      let callCount = 0;
      strategy.processChunk.mockImplementation(function* (chunk: string) {
        yield {
          isMatch: true,
          content: callCount++ === 0 ? "outer" : "inner",
          streamIndices: [0, chunk.length]
        };
      });

      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
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
      const strategy = {
        createState: () => ({ seen: 0 }),
        processChunk: vi.fn().mockImplementation(function* (chunk: string) {
          yield {
            isMatch: true,
            content: chunk,
            streamIndices: [0, chunk.length]
          };
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((match: string) => match)
      };

      const { sink, chunks } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine<object, string>({
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

  describe("depth in ReplacementContext", () => {
    function matchAllStrategy() {
      return {
        createState: () => ({}),
        processChunk: vi.fn().mockImplementation(function* (chunk: string) {
          yield { isMatch: true, content: chunk, streamIndices: [0, chunk.length] as [number, number] };
        }),
        flush: vi.fn().mockReturnValue(""),
        matchToString: vi.fn().mockImplementation((m: string) => m)
      };
    }

    it("passes depth 0 for top-level matches", async () => {
      const depths: number[] = [];
      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
      const { sink } = collectingSink();
      const engine = new AsyncLookaheadTransformEngine({
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
});
