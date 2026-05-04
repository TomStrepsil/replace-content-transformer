import { describe, it, expect, vi } from "vitest";
import { LookaheadEngine, type LookaheadSink } from "./engine.ts";
import { SemaphoreStrategy } from "./concurrency-strategy/semaphore-strategy.ts";
import type { ConcurrencyStrategy } from "./concurrency-strategy/types.ts";
import type { IterableSlotNode } from "./slot-tree/types.ts";
import { nested } from "./nested.ts";
import {
  asyncIterable,
  deferred,
  mockSearchStrategyFactory,
  settleMicrotasks
} from "../../test/utilities.ts";

function collectingSink(): {
  sink: LookaheadSink;
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
  engine: LookaheadEngine<object, string>,
  inputs: string[]
): Promise<void> {
  engine.start();
  for (const input of inputs) await engine.write(input);
  await engine.end();
}

describe("LookaheadEngine", () => {
  describe("text slots", () => {
    it("emits non-match text directly to the sink", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "hello " },
        { isMatch: false, content: "world" }
      );
      const { sink, chunks } = collectingSink();
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () => asyncIterable("unused"),
          concurrencyStrategy: new SemaphoreStrategy(2)
        },
        sink
      );
      await runEngine(engine, ["hello world"]);
      expect(chunks.join("")).toBe("hello world");
    });

    it("emits the search-strategy flush tail when non-empty", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "head "
      });
      strategy.flush.mockReturnValue("tail");
      const { sink, chunks } = collectingSink();
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () => asyncIterable(""),
          concurrencyStrategy: new SemaphoreStrategy(1)
        },
        sink
      );
      await runEngine(engine, ["head "]);
      expect(chunks.join("")).toBe("head tail");
      expect(strategy.flush).toHaveBeenCalledOnce();
    });

    it("does not emit a tail slot when flush returns an empty string", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "only"
      });
      // flush() default is "" — ensure nothing extra is enqueued.
      const { sink, chunks } = collectingSink();
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () => asyncIterable(""),
          concurrencyStrategy: new SemaphoreStrategy(1)
        },
        sink
      );
      await runEngine(engine, ["only"]);
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
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () => asyncIterable("A1", "A2"),
          concurrencyStrategy: new SemaphoreStrategy(2)
        },
        sink
      );
      await runEngine(engine, ["pre M post"]);
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
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () =>
            callCount++ === 0 ? gateA.promise : gateB.promise,
          concurrencyStrategy: new SemaphoreStrategy(2)
        },
        sink
      );
      engine.start();
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
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () => {
            const callIndex = callCount++;
            started.push(callIndex);
            return callIndex === 0 ? firstGate.promise : asyncIterable("b");
          },
          concurrencyStrategy: new SemaphoreStrategy(2)
        },
        sink
      );
      engine.start();
      await engine.write("AB");
      await settleMicrotasks(5);
      expect(started).toEqual([0, 1]);
      firstGate.resolve(asyncIterable("a"));
      await engine.end();
    });

    it("passes match, matchIndex, and streamIndices to the replacement function", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: true, content: "A", streamIndices: [0, 1] },
        { isMatch: true, content: "B", streamIndices: [3, 4] }
      );
      const replacement = vi.fn(async () => asyncIterable(""));

      const { sink } = collectingSink();
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement,
          concurrencyStrategy: new SemaphoreStrategy(2)
        },
        sink
      );
      await runEngine(engine, ["AB"]);

      expect(replacement).toHaveBeenNthCalledWith(1, "A", 0, [0, 1]);
      expect(replacement).toHaveBeenNthCalledWith(2, "B", 1, [3, 4]);
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
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () => asyncIterable("x"),
          concurrencyStrategy: spy
        },
        sink
      );
      await runEngine(engine, ["AB"]);
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
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () => gates[callCount++].promise,
          concurrencyStrategy: new SemaphoreStrategy(8),
          highWaterMark: 1
        },
        sink
      );
      engine.start();

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
      const engine = new LookaheadEngine(
        {
          searchStrategy: strategy,
          replacement: async () => {
            throw new Error("boom");
          },
          concurrencyStrategy: new SemaphoreStrategy(1)
        },
        sink
      );
      engine.start();
      await engine.write("M");
      await expect(engine.end()).rejects.toThrow("boom");
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("boom");
    });
  });

  describe("nested re-scanning", () => {
    it("spawns a child engine to re-scan nested() content", async () => {
      // Outer matches "{{X}}"; if X === "outer", re-scan nested body
      // containing "{{leaf}}" which itself matches and is replaced.
      const strategy = {
        createState: () => ({}),
        processChunk: vi.fn().mockImplementation(function* (chunk: string) {
          // Simple tokeniser: emit any "{{word}}" as a match, other as text.
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
      const engine = new LookaheadEngine<object, string>(
        {
          searchStrategy: strategy,
          concurrencyStrategy: new SemaphoreStrategy(4),
          replacement: async (match) => {
            if (match === "{{outer}}")
              return nested(asyncIterable("[{{leaf}}]"));
            if (match === "{{leaf}}") return asyncIterable("LEAF");
            return asyncIterable(match);
          }
        },
        sink
      );
      await runEngine(engine, ["<{{outer}}>"]);
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
      // After the outer match, the child engine is re-scanning the nested
      // body. We set up a second mock strategy inside, but since the
      // engine reuses the same searchStrategy factory's createState (and
      // our mock yields the same canned results unconditionally), we need
      // a strategy that yields a match only once at the outer level.
      // Use a call-count-aware mock instead.
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
      const engine = new LookaheadEngine<object, string>(
        {
          searchStrategy: strategy,
          concurrencyStrategy: spy,
          replacement: async (match) => {
            if (match === "outer") return nested(asyncIterable("inner"));
            return asyncIterable("LEAF");
          }
        },
        sink
      );
      await runEngine(engine, ["outer"]);

      expect(scheduled).toHaveLength(2);
      expect(scheduled[0].parent).toBeNull();
      // Inner match's slot has the outer slot as its parent.
      expect(scheduled[1].parent).toBe(scheduled[0]);
    });

    it("wakes the consumer when a child enqueue arrives after the consumer has begun waiting", async () => {
      // Source yields one chunk, then awaits a gate, then yields another.
      // This guarantees the outer drain enters its `await notify` branch
      // before the second enqueue — exercising the wake() inside the
      // child sink's enqueue path.
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
      // The child's own search strategy gets re-created (via
      // options.searchStrategy.createState). Our mock emits the same
      // canned match every invocation; guard with a call counter so the
      // child scans only non-match text.
      let callCount = 0;
      strategy.processChunk.mockImplementation(function* (chunk: string) {
        if (callCount++ === 0) {
          yield { isMatch: true, content: "M", streamIndices: [0, 1] };
        } else {
          yield { isMatch: false, content: chunk };
        }
      });

      const { sink, chunks } = collectingSink();
      const engine = new LookaheadEngine<object, string>(
        {
          searchStrategy: strategy,
          concurrencyStrategy: new SemaphoreStrategy(2),
          replacement: async () => nested(nestedSource())
        },
        sink
      );
      engine.start();
      await engine.write("M");

      // Wait until the outer drain has consumed the first chunk.
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
      const engine = new LookaheadEngine<object, string>(
        {
          searchStrategy: strategy,
          concurrencyStrategy: new SemaphoreStrategy(2),
          replacement: async () => nested(failingSource())
        },
        sink
      );
      engine.start();
      await engine.write("M");
      await expect(engine.end()).rejects.toThrow("source failed");
    });

    it("surfaces a child engine failure via the nested bridge", async () => {
      // Inner match's replacement throws — child drain fails, child
      // sink.error fires, bridge's childErr is set and re-thrown by the
      // outer generator after any buffered chunks drain.
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
      const engine = new LookaheadEngine<object, string>(
        {
          searchStrategy: strategy,
          concurrencyStrategy: new SemaphoreStrategy(2),
          replacement: async (match) => {
            if (match === "outer") return nested(asyncIterable("inner"));
            throw new Error("inner boom");
          }
        },
        sink
      );
      engine.start();
      await engine.write("outer");
      await expect(engine.end()).rejects.toThrow("inner boom");
    });

    it("supports deeper (>1 level) nesting", async () => {
      // "L0" → nested("L1") → nested("L2") → "LEAF"
      const strategy = {
        createState: () => ({ seen: 0 }),
        processChunk: vi.fn().mockImplementation(function* (chunk: string) {
          // Whole chunk is always a single match.
          yield {
            isMatch: true,
            content: chunk,
            streamIndices: [0, chunk.length]
          };
        }),
        flush: vi.fn().mockReturnValue("")
      };

      const { sink, chunks } = collectingSink();
      const engine = new LookaheadEngine<object, string>(
        {
          searchStrategy: strategy,
          concurrencyStrategy: new SemaphoreStrategy(4),
          replacement: async (match) => {
            if (match === "L0") return nested(asyncIterable("L1"));
            if (match === "L1") return nested(asyncIterable("L2"));
            if (match === "L2") return asyncIterable("LEAF");
            return asyncIterable(match);
          }
        },
        sink
      );
      await runEngine(engine, ["L0"]);
      expect(chunks.join("")).toBe("LEAF");
    });
  });
});
