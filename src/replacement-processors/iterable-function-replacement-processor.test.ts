import { describe, it, expect, vi } from "vitest";
import { IterableFunctionReplacementProcessor } from "./iterable-function-replacement-processor.ts";
import { mockSearchStrategyFactory } from "../../test/utilities.ts";

describe("IterableFunctionReplacementProcessor", () => {
  const mockInput = "test input";

  it("yields iterable content chunk-by-chunk without buffering", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "Hello ", match: false },
      { content: "OLD", match: true },
      { content: " world", match: false }
    );
    const iterableChunks = ["chunk1", "chunk2", "chunk3"];

    const processor = new IterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: () => iterableChunks
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(mockStrategy.processChunk).toHaveBeenCalledWith(mockInput, {});
    expect(outputChunks).toEqual([
      "Hello ",
      "chunk1",
      "chunk2",
      "chunk3",
      " world"
    ]);
  });

  it("handles multiple matches with different iterable replacements", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "OLD", match: true },
      { content: " and ", match: false },
      { content: "OLD", match: true }
    );

    const iterable1Chunks = ["A1", "A2"];
    const iterable2Chunks = ["B1", "B2"];

    let iterableIndex = 0;
    const iterableFactory = () => {
      return iterableIndex++ === 0 ? iterable1Chunks : iterable2Chunks;
    };

    const processor = new IterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: iterableFactory
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(mockStrategy.processChunk).toHaveBeenCalledWith(mockInput, {});
    expect(outputChunks).toEqual(["A1", "A2", " and ", "B1", "B2"]);
  });

  it("handles empty iterable replacement", async () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "Hello ", match: false },
      { content: "OLD", match: true },
      { content: " world", match: false }
    );

    const emptyIterable: string[] = [];

    const processor = new IterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: () => emptyIterable
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["Hello ", " world"]);
  });

  it("handles iterable replacement with match context and index", async () => {
    const mockStrategy = {
      createState: vi.fn().mockReturnValue({}),
      processChunk: vi.fn().mockImplementation(function* () {
        yield { content: "MATCH", match: true };
      }),
      flush: vi.fn().mockReturnValue("")
    };

    const iterableFactory = (matchedContent: string, index: number) => {
      return [`[${matchedContent}:${index}]`];
    };

    const processor = new IterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: iterableFactory
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(mockStrategy.processChunk).toHaveBeenCalledTimes(2);
    expect(mockStrategy.processChunk).toHaveBeenNthCalledWith(1, mockInput, {});
    expect(mockStrategy.processChunk).toHaveBeenNthCalledWith(2, mockInput, {});
    expect(outputChunks).toEqual(["[MATCH:0]", "[MATCH:1]"]);
  });

  it("buffers incomplete match across chunks with iterable replacement", async () => {
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

    const iterableChunks = ["N", "E", "W"];

    const processor = new IterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: () => iterableChunks
    });

    const outputChunks: string[] = [];

    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(mockStrategy.processChunk).toHaveBeenCalledTimes(2);
    expect(mockStrategy.processChunk).toHaveBeenNthCalledWith(1, mockInput, {});
    expect(mockStrategy.processChunk).toHaveBeenNthCalledWith(2, mockInput, {});
    expect(outputChunks).toEqual(["text ", "N", "E", "W", " end"]);
  });

  describe("flush", () => {
  it("returns buffered content when called", async () => {
    const mockStrategy = mockSearchStrategyFactory({
      content: "text ",
      match: false
    });
    mockStrategy.flush.mockReturnValue("OL");

    const processor = new IterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: () => []
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty -- just processing to create buffer
    for (const _chunk of processor.processChunk(mockInput)) {
    }

    const flushed = processor.flush();
    expect(flushed).toBe("OL");
    expect(mockStrategy.flush).toHaveBeenCalled();
  });

  it("returns empty string when no buffered content", async () => {
    const mockStrategy = mockSearchStrategyFactory();

    const processor = new IterableFunctionReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: () => []
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty -- just processing
    for (const _chunk of processor.processChunk("test")) {
    }
    const flushed = processor.flush();
    expect(flushed).toBe("");
  });
});
});


