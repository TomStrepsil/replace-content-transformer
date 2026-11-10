import type { MatchSink, SearchStrategy } from "../src/search-strategies/types.ts";
import type { MatchResult } from "./search-strategy-results.ts";
import type { IterableSlotNode } from "../src/engines/async-lookahead-transform-engine/slot-tree/types.ts";
import type { Nested } from "../src/engines/async-lookahead-transform-engine/nested.ts";
import type {
  AsyncTransformEngine,
  EngineSink,
  SyncTransformEngine
} from "../src/engines/types.ts";
import { SLOT_KIND } from "../src/engines/async-lookahead-transform-engine/slot-tree/constants.ts";
import { Writable } from "node:stream";
import { vi, type Mocked } from "vitest";

type TestHttpHandler = (request: Request) => Response | Promise<Response>;

type StartedTestHttpServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

async function handleTestHttpRequest(
  request: Request,
  handlers: Record<string, TestHttpHandler>
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const handler = handlers[pathname];

  if (!handler) {
    return new Response("Not Found", { status: 404 });
  }

  return await handler(request);
}

async function startTestHttpServer(
  handlers: Record<string, TestHttpHandler>
): Promise<StartedTestHttpServer> {
  if (typeof Bun !== "undefined") {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => handleTestHttpRequest(request, handlers)
    });

    return {
      baseUrl: `http://127.0.0.1:${server.port}`,
      close: async () => {
        server.stop(true);
      }
    };
  }

  if (typeof Deno !== "undefined") {
    const abortController = new AbortController();
    const server = Deno.serve(
      {
        hostname: "127.0.0.1",
        port: 0,
        signal: abortController.signal
      },
      (request) => handleTestHttpRequest(request, handlers)
    );

    const addr = server.addr as { port: number };

    return {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      close: async () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
        await server.finished;
      }
    };
  }

  const { createServer } = await import("node:http");

  const server = createServer(async (incoming, outgoing) => {
    try {
      const host = incoming.headers.host ?? "127.0.0.1";
      const url = new URL(incoming.url ?? "/", `http://${host}`);
      const request = new Request(url.toString(), {
        method: incoming.method ?? "GET",
        headers: incoming.headers as HeadersInit
      });

      const response = await handleTestHttpRequest(request, handlers);
      outgoing.statusCode = response.status;

      response.headers.forEach((value, key) => {
        outgoing.setHeader(key, value);
      });

      const body = new Uint8Array(await response.arrayBuffer());
      outgoing.end(Buffer.from(body));
    } catch (error) {
      outgoing.statusCode = 500;
      outgoing.end(String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function streamToString(stream: ReadableStream<string>): Promise<string> {
  let output = "";

  for await (const chunk of stream) {
    output += chunk;
  }

  return output;
}

/**
 * Create an {@link IterableSlotNode} skeleton suitable for handing to a
 * `ConcurrencyStrategy.acquire()` call. The `iterable` field is left as
 * a never-resolving placeholder — strategy unit tests don't drive it.
 */
function createIterableSlotNode(
  siblingIndex: number,
  parent: IterableSlotNode | null
): IterableSlotNode {
  return {
    kind: SLOT_KIND.iterable,
    siblingIndex,
    depth: parent !== null ? parent.depth + 1 : 0,
    parent,
    iterable: new Promise<AsyncIterable<string> | Nested>(() => {})
  };
}

/**
 * Build an `AsyncIterable<string>` that yields the given chunks in order.
 *
 * (Awaiting AsyncIterator.from(chunks) in proposal: https://github.com/tc39/proposal-async-iterator-helpers)
 */
function asyncIterable(...chunks: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield* chunks;
    }
  };
}

/** Thin wrapper over {@link Promise.withResolvers} for test expressiveness. */
function deferred<T>(): PromiseWithResolvers<T> {
  return Promise.withResolvers<T>();
}

/** A result for a mock strategy to report, or a callback to run when it reaches that point. */
type MockStep<TMatch> = MatchResult<TMatch> | (() => void);

type MockSearchState<TMatch> = { unreported?: MockStep<TMatch>[] };

/**
 * A mock strategy that reports `chunk`'s steps for every chunk, and `settled`'s from
 * `settle` when given. Stopped at a match, it keeps the steps not yet reported in `state`:
 * a call with `""` (or `settle` again) carries on with them, and `flush` returns them as
 * raw text, followed by `rest`. `pulled` counts the results it reported.
 */
function mockSearchStrategy<TMatch = string>({
  chunk = [],
  settled,
  rest = ""
}: {
  chunk?: MockStep<TMatch>[] | ((haystack: string) => MockStep<TMatch>[]);
  settled?: MockStep<TMatch>[] | (() => MockStep<TMatch>[]);
  rest?: string;
} = {}) {
  const counts = { pulled: 0 };
  const stepsFor = typeof chunk === "function" ? chunk : () => chunk;
  const report = (
    steps: MockStep<TMatch>[],
    state: MockSearchState<TMatch>,
    sink: MatchSink<TMatch>
  ): undefined => {
    state.unreported = undefined;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (typeof step === "function") {
        step();
        continue;
      }
      counts.pulled++;
      if (!step.isMatch) {
        sink.reportText(step.content);
      } else if (!sink.reportMatch(step.content, step.streamIndices)) {
        state.unreported = steps.slice(index + 1);
        return;
      }
    }
  };
  const strategy: Mocked<SearchStrategy<MockSearchState<TMatch>, TMatch>> = {
    createState: vi.fn((): MockSearchState<TMatch> => ({})),
    processChunk: vi.fn((haystack: string, state: MockSearchState<TMatch>, sink: MatchSink<TMatch>) =>
      report(state.unreported ?? stepsFor(haystack), state, sink)
    ),
    flush: vi.fn((state: MockSearchState<TMatch>) => {
      const unreported = state.unreported;
      state.unreported = undefined;
      if (unreported === undefined) return "";
      const text = unreported
        .filter((step) => typeof step !== "function")
        .map((step) => (step.isMatch ? strategy.matchToString(step.content) : step.content))
        .join("");
      return text + rest;
    }),
    matchToString: vi.fn((match: TMatch) => String(match))
  };
  if (settled !== undefined) {
    const settledSteps = typeof settled === "function" ? settled : () => settled;
    strategy.settle = vi.fn((state: MockSearchState<TMatch>, sink: MatchSink<TMatch>) =>
      report(state.unreported ?? settledSteps(), state, sink)
    );
  }
  return { strategy, counts };
}

/** A {@link mockSearchStrategy} that reports `results` for every chunk. */
function mockSearchStrategyFactory<TMatch = string>(...results: MatchResult<TMatch>[]) {
  return mockSearchStrategy<TMatch>({ chunk: results }).strategy;
}

/**
 * A replacement mock that aborts `controller` on its first call, and returns a fresh
 * `result()` on every call.
 */
function abortingOnFirstCall<T>(controller: AbortController, result: () => T) {
  return vi.fn(() => {
    if (!controller.signal.aborted) controller.abort();
    return result();
  });
}

function mockTransformStreamDefaultControllerFactory<T = string>(
  outputs: T[]
): Mocked<TransformStreamDefaultController<T>> {
  return {
    enqueue: vi.fn().mockImplementation((chunk: T) => {
      outputs.push(chunk);
    }),
    desiredSize: null,
    error: vi.fn(),
    terminate: vi.fn()
  };
}

function collectEngineSink(): {
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

function collectWritable(): { writable: Writable; outputs: string[] } {
  const outputs: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      outputs.push(chunk.toString());
      callback();
    }
  });
  return { writable, outputs };
}

function mockSyncEngine() {
  return {
    start: vi.fn<(sink: EngineSink) => void>(),
    write: vi.fn<(chunk: string) => void>(),
    end: vi.fn<() => void>()
  } satisfies SyncTransformEngine;
}

function mockAsyncEngine() {
  return {
    start: vi.fn<(sink: EngineSink) => void>(),
    write: vi
      .fn<(chunk: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancel: vi.fn<() => void>()
  } satisfies AsyncTransformEngine;
}

function textWrittenTo(engine: { write: { mock: { calls: [string][] } } }) {
  return engine.write.mock.calls.map(([chunk]) => chunk).join("");
}

/**
 * Code units examined by `String.prototype.indexOf` (up to the end of each
 * occurrence found) while `run` ran. The anchor and balanced pair strategies
 * search with it, so this counts their search work deterministically, where
 * timing is noisy.
 */
function indexOfWork(run: () => void): number {
  const strings = String.prototype;
  const { indexOf } = strings;
  let work = 0;
  strings.indexOf = function (this: string, searchString: string, position = 0) {
    const found = indexOf.call(this, searchString, position);
    const searchedTo = found === -1 ? this.length : found + searchString.length;
    work += Math.max(0, searchedTo - Math.max(0, position));
    return found;
  };
  try {
    run();
    return work;
  } finally {
    strings.indexOf = indexOf;
  }
}

function startedSinkOf(engine: {
  start: { mock: { lastCall: [EngineSink] | undefined } };
}): EngineSink {
  const lastCall = engine.start.mock.lastCall;
  if (!lastCall) throw new Error("engine.start has not been called");
  return lastCall[0];
}

export type { CanonicalSegment, GuardedStrategy, MatchResult } from "./search-strategy-results.ts";
export type { MockStep };

export {
  asMatch,
  asText,
  collectCanonicalSearchStrategyResults,
  collectPausedSearchStrategyResults,
  collectSearchStrategyResults,
  collectStoppedSearchStrategyResults,
  heldWhileDriving,
  outputWhenGuardThrows,
  processChunkResults,
  regexMatchDetailsOf,
  settleResults,
  sinkInto
} from "./search-strategy-results.ts";

export {
  abortingOnFirstCall,
  collectEngineSink,
  collectWritable,
  asyncIterable,
  createIterableSlotNode,
  deferred,
  indexOfWork,
  mockAsyncEngine,
  mockSearchStrategy,
  mockSearchStrategyFactory,
  mockSyncEngine,
  mockTransformStreamDefaultControllerFactory,
  startTestHttpServer,
  startedSinkOf,
  streamToString,
  textWrittenTo
};
