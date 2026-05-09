import type { MatchResult, SearchStrategy } from "../src/search-strategies/types.ts";
import type { IterableSlotNode } from "../src/engines/async-lookahead-transform-engine/slot-tree/types.ts";
import type { Nested } from "../src/engines/async-lookahead-transform-engine/nested.ts";
import { SLOT_KIND } from "../src/engines/async-lookahead-transform-engine/slot-tree/constants.ts";
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
  return { [Symbol.asyncIterator]: async function* () { yield* chunks; } };
}

/** Thin wrapper over {@link Promise.withResolvers} for test expressiveness. */
function deferred<T>(): PromiseWithResolvers<T> {
  return Promise.withResolvers<T>();
}

/** Flush `times` rounds of microtasks — lets scheduled dispatches settle. */
async function settleMicrotasks(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function mockSearchStrategyFactory<TMatch = string>(...results: MatchResult<TMatch>[]): Mocked<SearchStrategy<object, TMatch>> {
  return {
    createState: vi.fn().mockReturnValue({}),
    processChunk: vi.fn().mockImplementation(function* () {
      for (const result of results) {
        yield result;
      }
    }),
    flush: vi.fn().mockReturnValue(""),
    matchToString: vi.fn().mockImplementation((match: TMatch) => String(match))
  };
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

function mockSyncProcessorFactory(...output: (string | (() => string))[]) {
  return {
    processChunk: vi.fn().mockImplementation(function* () {
      for (const chunk of output) {
        if (typeof chunk === "function") {
          yield chunk();
          continue;
        }
        yield chunk;
      }
    }),
    flush: vi.fn().mockReturnValue("")
  };
}

function mockAsyncProcessorFactory(...output: (string | (() => string))[]) {
  return {
    processChunk: vi.fn().mockImplementation(async function* () {
      for (const chunk of output) {
        if (typeof chunk === "function") {
          yield chunk();
          continue;
        }
        yield chunk;
      }
    }),
    flush: vi.fn().mockReturnValue("")
  };
}

export {
  asyncIterable,
  createIterableSlotNode,
  deferred,
  mockAsyncProcessorFactory,
  mockSearchStrategyFactory,
  mockSyncProcessorFactory,
  mockTransformStreamDefaultControllerFactory,
  settleMicrotasks,
  startTestHttpServer,
  streamToString
};
