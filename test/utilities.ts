import type { MatchResult } from "../src/search-strategies/types.ts";
import { vi, type Mocked } from "vitest";
export { server } from "./vitest.setup";

function mockSearchStrategyFactory(...results: MatchResult[]) {
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
    flush: vi.fn().mockReturnValue("<FLUSHED>")
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
    flush: vi.fn().mockReturnValue("<FLUSHED>")
  };
}

export {
  mockAsyncProcessorFactory,
  mockSearchStrategyFactory,
  mockSyncProcessorFactory,
  mockTransformStreamDefaultControllerFactory
};
