import { describe, it, expect, vi } from "vitest";
import { AsyncLookaheadTransformEngine } from "./engine.ts";
import { SemaphoreStrategy } from "./concurrency-strategy/semaphore-strategy.ts";
import type { ConcurrencyStrategy } from "./concurrency-strategy/types.ts";
import type { IterableSlotNode } from "./slot-tree/types.ts";
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

      expect(replacement).toHaveBeenNthCalledWith(1, "A", { matchIndex: 0, streamIndices: [0, 1] });
      expect(replacement).toHaveBeenNthCalledWith(2, "B", { matchIndex: 1, streamIndices: [3, 4] });
    });

    it("hands each match's slot to the concurrency strategy with a null parent at the root", async () => {
      const scheduled: IterableSlotNode[] = [];
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
        flush: vi.fn().mockReturnValue("")
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
      const scheduled: IterableSlotNode[] = [];
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
        flush: vi.fn().mockReturnValue("")
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
});
