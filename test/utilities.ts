import type { MatchResult, SearchStrategy } from "../src/search-strategies/types.ts";
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

function mockSearchStrategyFactory<TMatch = string>(...results: MatchResult<TMatch>[]): Mocked<SearchStrategy<object, TMatch>> {
  return {
    createState: vi.fn().mockReturnValue({}),
    processChunk: vi.fn().mockImplementation(function* () {
      for (const result of results) {
        yield result;
      }
    }),
    flush: vi.fn().mockReturnValue("")
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

function mockSyncProcessorFactory<T extends string | Promise<string> = string>(...output: (T | (() => T))[]) {
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
  mockAsyncProcessorFactory,
  mockSearchStrategyFactory,
  mockSyncProcessorFactory,
  mockTransformStreamDefaultControllerFactory,
  startTestHttpServer,
  streamToString
};
