import { describe, it, expect, vi } from "vitest";
import { mockSearchStrategyFactory } from "../../test/utilities.ts";
import { AsyncIterableFunctionReplacementProcessor } from "./async-iterable-function-replacement-processor.ts";

describe("AsyncIterableFunctionReplacementProcessor", () => {
  it("yields stream content chunk-by-chunk without buffering", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "Hello ", match: false },
      { content: "OLD", match: true },
      { content: " world", match: false }
    );

    const streamChunks = ["chunk1", "chunk2", "chunk3"];
    const readableStream = new ReadableStream({
      start(controller) {
        for (const chunk of streamChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      }
    });

    const processor = new AsyncIterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => readableStream
    });

    const outputChunks: string[] = [];
    for await (const chunk of processor.processChunk("Hello OLD world")) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual([
      "Hello ",
      "chunk1",
      "chunk2",
      "chunk3",
      " world"
    ]);
  });

  it("handles multiple matches with different stream replacements", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "OLD", match: true },
      { content: " and ", match: false },
      { content: "OLD", match: true }
    );

    const stream1Chunks = ["A1", "A2"];
    const stream2Chunks = ["B1", "B2"];

    let streamIndex = 0;
    const streamFactory = async () => {
      const chunks = streamIndex++ === 0 ? stream1Chunks : stream2Chunks;
      return new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        }
      });
    };

    const processor = new AsyncIterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: streamFactory
    });

    const outputChunks: string[] = [];
    for await (const chunk of processor.processChunk("OLD and OLD")) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["A1", "A2", " and ", "B1", "B2"]);
  });

  it("handles empty stream replacement", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "Hello ", match: false },
      { content: "OLD", match: true },
      { content: " world", match: false }
    );

    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      }
    });

    const processor = new AsyncIterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => emptyStream
    });

    const outputChunks: string[] = [];
    for await (const chunk of processor.processChunk("Hello OLD world")) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["Hello ", " world"]);
  });

  it("handles stream replacement with match context and index", async () => {
    const mockStrategy = {
      createState: vi.fn().mockReturnValue({}),
      processChunk: vi.fn().mockImplementation(function* () {
        yield { content: "MATCH", match: true };
      }),
      flush: vi.fn().mockReturnValue("")
    };

    const streamFactory = async (matchedContent: string, index: number) => {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(`[${matchedContent}:${index}]`);
          controller.close();
        }
      });
    };

    const processor = new AsyncIterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: streamFactory
    });

    const outputChunks: string[] = [];
    for await (const chunk of processor.processChunk("MATCH")) {
      outputChunks.push(chunk);
    }
    for await (const chunk of processor.processChunk("MATCH")) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["[MATCH:0]", "[MATCH:1]"]);
  });

  it("buffers incomplete match across chunks with stream replacement", async () => {
    let callCount = 0;
    const mockStrategy = {
      createState: vi.fn().mockReturnValue({}),
      processChunk: vi.fn().mockImplementation(function* () {
        callCount++;
        if (callCount === 1) {
          yield { content: "text ", match: false };
        } else {
          yield { content: "OLD", match: true };
          yield { content: " end", match: false };
        }
      }),
      flush: vi.fn().mockReturnValue("")
    };

    const streamChunks = ["N", "E", "W"];
    const readableStream = new ReadableStream({
      start(controller) {
        for (const chunk of streamChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      }
    });

    const processor = new AsyncIterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => readableStream
    });

    const outputChunks: string[] = [];

    for await (const chunk of processor.processChunk("text OL")) {
      outputChunks.push(chunk);
    }

    for await (const chunk of processor.processChunk("D end")) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["text ", "N", "E", "W", " end"]);
  });
});

describe("flush", () => {
  it("returns buffered content when called", async () => {
    const mockStrategy = mockSearchStrategyFactory({
      content: "text ",
      match: false
    });
    mockStrategy.flush.mockReturnValue("OL");

    const processor = new AsyncIterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => new ReadableStream()
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

    const processor = new AsyncIterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: async () => new ReadableStream()
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty -- just processing
    for await (const _chunk of processor.processChunk("test")) {
    }
    const flushed = processor.flush();
    expect(flushed).toBe("");
  });
});
