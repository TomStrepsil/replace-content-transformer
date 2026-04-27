import { describe, it, expect, vi } from "vitest";
import { mockSearchStrategyFactory } from "../../test/utilities.js";
import { AsyncFunctionReplacementProcessor } from "./async-function-replacement-processor.js";
import { inspect } from "node:util";

describe("AsyncFunctionReplacementProcessor", () => {
  it("calls async replacement function with match and context", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { isMatch: false, content: "Hello " },
      { isMatch: true, content: "MATCH", streamIndices: [6, 11] },
      { isMatch: false, content: " world" }
    );

    const asyncReplacementFn = vi.fn().mockResolvedValue("ASYNC_RESULT");

    const processor = new AsyncFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: asyncReplacementFn
    });

    const outputChunks: string[] = [];
    for await (const chunk of processor.processChunk("Hello MATCH world")) {
      outputChunks.push(chunk);
    }

    expect(asyncReplacementFn).toHaveBeenCalledWith("MATCH", {
      matchIndex: 0,
      streamIndices: [6, 11]
    });
    expect(outputChunks).toEqual(["Hello ", "ASYNC_RESULT", " world"]);
  });

  it("increments match index for subsequent async matches", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { isMatch: true, content: "MATCH", streamIndices: [0, 5] },
      { isMatch: false, content: " and " },
      { isMatch: true, content: "MATCH", streamIndices: [10, 15] }
    );

    const asyncReplacementFn = vi.fn().mockResolvedValue("ASYNC");

    const processor = new AsyncFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: asyncReplacementFn
    });

    const outputChunks: string[] = [];

    for await (const chunk of processor.processChunk("MATCH and MATCH")) {
      outputChunks.push(chunk);
    }

    expect(asyncReplacementFn).toHaveBeenNthCalledWith(1, "MATCH", {
      matchIndex: 0,
      streamIndices: [0, 5]
    });
    expect(asyncReplacementFn).toHaveBeenNthCalledWith(2, "MATCH", {
      matchIndex: 1,
      streamIndices: [10, 15]
    });
  });

  it("handles string replacement with async processor", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { isMatch: false, content: "Hello " },
      { isMatch: true, content: "OLD", streamIndices: [6, 9] },
      { isMatch: false, content: " world" }
    );

    const processor = new AsyncFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => "NEW"
    });

    const outputChunks: string[] = [];
    for await (const chunk of processor.processChunk("Hello OLD world")) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["Hello ", "NEW", " world"]);
  });

  it("buffers incomplete match across chunks", async () => {
    let callCount = 0;
    const mockStrategy = {
      createState: vi.fn().mockReturnValue({}),
      processChunk: vi.fn().mockImplementation(function* () {
        callCount++;
        if (callCount === 1) {
          yield { isMatch: false, content: "text " };
        } else {
          yield { isMatch: true, content: "OLD", streamIndices: [5, 8] };
          yield { isMatch: false, content: " end" };
        }
      }),
      flush: vi.fn().mockReturnValue("")
    };

    const processor = new AsyncFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => "NEW"
    });

    const outputChunks: string[] = [];

    for await (const chunk of processor.processChunk("text OL")) {
      outputChunks.push(chunk);
    }

    for await (const chunk of processor.processChunk("D end")) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["text ", "NEW", " end"]);
  });

  it("ensures iterator awaits each async replacement before proceeding, if the consumer iterates without awaiting", async () => {
    const resolves: ((value: string) => void)[] = [];
    const asyncReplacementFn = vi.fn().mockImplementation(() => {
      const { promise, resolve } = Promise.withResolvers<string>();
      resolves.push(resolve);
      return promise;
    });

    const mockStrategy = mockSearchStrategyFactory(
      { isMatch: true, content: "OLD", streamIndices: [0, 3] },
      { isMatch: false, content: " and " },
      { isMatch: true, content: "OLD", streamIndices: [8, 11] }
    );

    const processor = new AsyncFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: asyncReplacementFn
    });

    const results: Promise<IteratorResult<string>>[] = [];
    const iterable = processor.processChunk("OLD and OLD");
    for (const value of [iterable.next(), iterable.next(), iterable.next()]) {
      results.push(value);
    }

    expect(asyncReplacementFn).toHaveBeenCalledTimes(1);
    resolves[0]("NEW 0");
    await expect(results[0]).resolves.toEqual({ done: false, value: "NEW 0" });
    await expect(results[1]).resolves.toEqual({ done: false, value: " and " });
    expect(inspect(results[2])).toContain("pending");
    expect(asyncReplacementFn).toHaveBeenCalledTimes(2);
    resolves[1]("NEW 1");
    await expect(results[2]).resolves.toEqual({ done: false, value: "NEW 1" });
  });
});

describe("flush", () => {
  it("returns buffered content when called", async () => {
    const mockStrategy = mockSearchStrategyFactory({
      isMatch: false,
      content: "text "
    });
    mockStrategy.flush.mockReturnValue("OL");

    const processor = new AsyncFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => "NEW"
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty -- just processing to create buffer
    for await (const _chunk of processor.processChunk("text OL")) {
    }

    const flushed = processor.flush();
    expect(flushed).toBe("OL");
    expect(mockStrategy.flush).toHaveBeenCalled();
  });

  it("returns empty string when no buffered content", async () => {
    const mockStrategy = mockSearchStrategyFactory();

    const processor = new AsyncFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => "NEW"
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty -- just processing
    for await (const _chunk of processor.processChunk("test")) {
    }
    const flushed = processor.flush();
    expect(flushed).toBe("");
  });
});
