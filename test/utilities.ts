import type { MatchSink, SearchStrategy } from "../src/search-strategies/types.ts";
import type { MatchResult } from "./search-strategy-results.ts";
import type { IterableSlotNode } from "../src/engines/lookahead-transform-engine/slot-tree/types.ts";
import { nested, type Nested } from "../src/engines/lookahead-transform-engine/nested.ts";
import type {
  EngineSink,
  TransformEngine,
  Utf8Bytes
} from "../src/engines/types.ts";
import { SLOT_KIND } from "../src/engines/lookahead-transform-engine/slot-tree/constants.ts";
import {
  LookaheadTransformEngine,
  SemaphoreStrategy,
  SerialTransformEngine,
  type LookaheadReplacementFn
} from "../src/engines/index.ts";
import { StringAnchorSearchStrategy } from "../src/search-strategies/index.ts";
import { Writable } from "node:stream";
import { runInNewContext } from "node:vm";
import { onTestFinished, vi, type Mocked } from "vitest";

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

function drainedOrClosed(outgoing: Writable): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      outgoing.off("drain", done);
      outgoing.off("close", done);
      resolve();
    };
    outgoing.once("drain", done);
    outgoing.once("close", done);
  });
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

      const reader = response.body?.getReader();
      outgoing.once("close", () => void reader?.cancel().catch(() => {}));
      for (let read = await reader?.read(); read && !read.done; read = await reader!.read()) {
        if (!outgoing.write(read.value) && !outgoing.destroyed) await drainedOrClosed(outgoing);
      }
      outgoing.end();
    } catch (error) {
      if (outgoing.headersSent) {
        outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
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
 * Build an `AsyncIterable` that yields the given chunks in order.
 *
 * (Awaiting AsyncIterator.from(chunks) in proposal: https://github.com/tc39/proposal-async-iterator-helpers)
 */
function asyncIterable<T extends string | Utf8Bytes = string>(...chunks: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield* chunks;
    }
  };
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

type CollectedEngineSink<TChunk> = { sink: EngineSink; chunks: TChunk[]; errors: unknown[] };

type ByteReplacement = (
  match: string,
  context: { signal: AbortSignal }
) => Promise<AsyncIterable<string | Utf8Bytes>>;

/** Each engine, built to replace `{{…}}` matches with a replacement that may return bytes. */
const byteReplacementEngines = [
  {
    engine: "SerialTransformEngine",
    create: (replacement: ByteReplacement): TransformEngine =>
      new SerialTransformEngine({ searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]), replacement })
  },
  {
    engine: "LookaheadTransformEngine",
    create: (replacement: ByteReplacement): TransformEngine =>
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement
      })
  }
];

function stalledStream(match: string, cancelled: string[]): ReadableStream<string> {
  return new ReadableStream<string>({ cancel: () => void cancelled.push(match) });
}

/**
 * Engines that replace each `{{…}}` match with a `ReadableStream` that never
 * yields, calling `onCall` with each match as they call its replacement and
 * pushing to `cancelled` each match whose stream is cancelled. `called` lists
 * the matches of `a{{x}}b{{y}}c` each calls a replacement for before stalling.
 */
const stalledStreamReplacementEngines = [
  {
    engine: "SerialTransformEngine",
    called: ["{{x}}"],
    create: (cancelled: string[], onCall: (match: string) => void): TransformEngine =>
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: async (match) => {
          onCall(match);
          return stalledStream(match, cancelled);
        }
      })
  },
  {
    engine: "LookaheadTransformEngine",
    called: ["{{x}}", "{{y}}"],
    create: (cancelled: string[], onCall: (match: string) => void): TransformEngine =>
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(2),
        replacement: async (match) => {
          onCall(match);
          return stalledStream(match, cancelled);
        }
      })
  },
  {
    engine: "LookaheadTransformEngine, with nested() sources",
    called: ["{{x}}", "{{y}}"],
    create: (cancelled: string[], onCall: (match: string) => void): TransformEngine =>
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(2),
        replacement: async (match) => {
          onCall(match);
          return nested(stalledStream(match, cancelled));
        }
      })
  }
];

const GUARDED_MAX_BUFFER_LENGTH = 6;

const guardedAnchors = (onGuardExceeded?: () => void) =>
  new StringAnchorSearchStrategy(["{{", "}}"], { maxBufferLength: GUARDED_MAX_BUFFER_LENGTH, onGuardExceeded });

/** A callback that throws `error`. */
const throwing = (error: unknown) => (): never => {
  throw error;
};

/** A `SerialTransformEngine` upper-casing `{{…}}` matches, calling `onGuardExceeded` past a buffer limit of 6. */
const guardedSerial = (onGuardExceeded: () => void, stopReplacingSignal?: AbortSignal) =>
  new SerialTransformEngine({
    searchStrategy: guardedAnchors(onGuardExceeded),
    replacement: (match: string) => match.toUpperCase(),
    stopReplacingSignal
  });

/** A `LookaheadTransformEngine` replacing `{{…}}` matches, calling `onGuardExceeded` past a buffer limit of 6. */
const guardedLookahead = (
  onGuardExceeded: (() => void) | undefined,
  replacement: LookaheadReplacementFn<string>,
  stopReplacingSignal?: AbortSignal
) =>
  new LookaheadTransformEngine({
    searchStrategy: guardedAnchors(onGuardExceeded),
    concurrencyStrategy: new SemaphoreStrategy(4),
    replacement,
    stopReplacingSignal
  });

/**
 * Each engine, built to upper-case `{{…}}` matches, calling `onGuardExceeded` past a buffer limit of 6, and to stop
 * replacing when `stopReplacingSignal` aborts. `earlierMatchOnceStopped` says what becomes of a match found earlier in
 * the `write()` in which the signal aborts.
 */
const guardedEngines = [
  {
    engine: "SerialTransformEngine",
    earlierMatchOnceStopped: { outcome: "is still replaced", replaced: true },
    create: guardedSerial
  },
  {
    engine: "LookaheadTransformEngine",
    earlierMatchOnceStopped: {
      outcome: "passes through verbatim, since with SemaphoreStrategy its replacement hasn't been called yet",
      replaced: false
    },
    create: (onGuardExceeded: () => void, stopReplacingSignal?: AbortSignal): TransformEngine =>
      guardedLookahead(onGuardExceeded, async (match) => asyncIterable(match.toUpperCase()), stopReplacingSignal)
  }
];

const lookaheadFailure = new Error("failed");

/** Each way a `guardedLookahead` engine fails with `lookaheadFailure` on `a{{o}}b`, before the input need end. */
const lookaheadFailures = [
  {
    failure: "a replacement rejects",
    create: () => guardedLookahead(undefined, async () => Promise.reject(lookaheadFailure))
  },
  {
    failure: "onGuardExceeded throws within nested() content",
    create: () => guardedLookahead(throwing(lookaheadFailure), async () => nested(asyncIterable("<{{1234567", "89>")))
  }
];

const sinkKinds = [
  { sinkKind: "a sink that accepts bytes", acceptsBytes: true },
  { sinkKind: "a sink that receives only strings", acceptsBytes: false }
];

/** A sink that collects what it receives, accepting bytes as well as strings when `acceptsBytes` is set. */
function collectEngineSink(options?: { acceptsBytes?: false }): CollectedEngineSink<string>;
function collectEngineSink(options: { acceptsBytes: boolean }): CollectedEngineSink<string | Utf8Bytes>;
function collectEngineSink({ acceptsBytes = false }: { acceptsBytes?: boolean } = {}): CollectedEngineSink<
  string | Utf8Bytes
> {
  const chunks: (string | Utf8Bytes)[] = [];
  const errors: unknown[] = [];
  const enqueue = (chunk: string | Utf8Bytes) => chunks.push(chunk);
  const error = (err: unknown) => errors.push(err);
  return {
    sink: { enqueue, error, acceptsBytes },
    chunks,
    errors
  };
}

const utf8Encoder = new TextEncoder();

type EncodedBytes = ReturnType<TextEncoder["encode"]>;

function utf8(text: string): EncodedBytes {
  return utf8Encoder.encode(text);
}

/**
 * The UTF-8 bytes of `text` as a `Uint8Array` of another realm, which fails
 * `instanceof Uint8Array` here, as the chunks of a `fetch` body do for code
 * run in a `vm` context, such as a Jest test environment.
 */
function foreignRealmUtf8(text: string): Utf8Bytes {
  return runInNewContext("Uint8Array.from(bytes)", { bytes: [...utf8(text)] }) as Utf8Bytes;
}

/** Yields `first` then `second` as UTF-8 of the same length, from one buffer it overwrites for `second`. */
async function* reusingOneBuffer(first: string, second: string): AsyncGenerator<Utf8Bytes> {
  const buffer = utf8(first);
  yield buffer;
  buffer.set(utf8(second));
  yield buffer;
}

/** A copy of `bytes` in a resizable `ArrayBuffer`, which browsers refuse where a `BufferSource` is expected. */
function inResizableArrayBuffer(bytes: Utf8Bytes): Utf8Bytes {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength, { maxByteLength: bytes.byteLength * 2 + 1 }));
  copy.set(bytes);
  return copy;
}

/**
 * Makes `TextDecoder.decode` refuse a view of a resizable `ArrayBuffer` until
 * the test finishes, as browsers do, though Node, Deno and Bun accept one.
 */
function refuseResizableBuffersInTextDecoder(): void {
  const decode = TextDecoder.prototype.decode;
  const spy = vi
    .spyOn(TextDecoder.prototype, "decode")
    .mockImplementation(function (this: TextDecoder, input?: AllowSharedBufferSource, options?: TextDecodeOptions) {
      if (ArrayBuffer.isView(input) && (input.buffer as ArrayBuffer).resizable) {
        throw new TypeError("The provided ArrayBufferView value must not be resizable.");
      }
      return decode.call(this, input, options);
    });
  onTestFinished(() => spy.mockRestore());
}

/**
 * The text of `chunks`, each decoded on its own, so it throws unless every
 * byte chunk is valid UTF-8 that ends at a character boundary.
 */
function textOfPieces(chunks: (string | Utf8Bytes)[]): string {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return chunks.map((chunk) => (typeof chunk === "string" ? chunk : decoder.decode(new Uint8Array(chunk)))).join("");
}

/** An `AbortError` whose `cause` is `reason`, as Node's `stream.addAbortSignal` fails with. */
function abortErrorCausedBy(reason: unknown): Error {
  return Object.assign(new Error("The operation was aborted", { cause: reason }), { name: "AbortError" });
}

/**
 * A response body that, like a `fetch` body, errors with the signal's reason
 * once `signal` aborts, even while a read is pending; otherwise it stalls
 * after its first chunk.
 */
function stalledBodyAbortedBy(signal: AbortSignal, first: string): ReadableStream<EncodedBytes> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(utf8(first));
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    }
  });
}

/** The reasons of rejections left unhandled while `run` ran, or by the turn after it. */
async function unhandledRejectionsDuring(run: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const record = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", record);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off("unhandledRejection", record);
  }
  return reasons;
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
  } satisfies TransformEngine;
}

function mockAsyncEngine() {
  return {
    start: vi.fn<(sink: EngineSink) => void>(),
    write: vi
      .fn<(chunk: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancel: vi.fn<() => void>()
  } satisfies TransformEngine;
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
export type { ByteReplacement, MockStep };

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
  abortErrorCausedBy,
  abortingOnFirstCall,
  byteReplacementEngines,
  collectEngineSink,
  collectWritable,
  asyncIterable,
  createIterableSlotNode,
  indexOfWork,
  mockAsyncEngine,
  mockSearchStrategy,
  mockSearchStrategyFactory,
  mockSyncEngine,
  mockTransformStreamDefaultControllerFactory,
  sinkKinds,
  stalledBodyAbortedBy,
  stalledStreamReplacementEngines,
  startTestHttpServer,
  startedSinkOf,
  streamToString,
  refuseResizableBuffersInTextDecoder,
  inResizableArrayBuffer,
  reusingOneBuffer,
  textOfPieces,
  foreignRealmUtf8,
  guardedEngines,
  guardedLookahead,
  guardedSerial,
  lookaheadFailure,
  lookaheadFailures,
  throwing,
  textWrittenTo,
  unhandledRejectionsDuring,
  utf8
};
