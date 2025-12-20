import { describe, it, expect } from "vitest";
import { mockSearchStrategyFactory } from "../../test/utilities.ts";
import { StaticReplacementProcessor } from "./static-replacement-processor.ts";

describe("StaticReplacementProcessor", () => {
  const mockInput = "test input";

  it("yields input directly when search strategy finds no match", () => {
    const mockStrategy = mockSearchStrategyFactory({
      content: "test output",
      match: false
    });

    const processor = new StaticReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: "NEW"
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["test output"]);
    expect(mockStrategy.processChunk).toHaveBeenCalledWith(mockInput, {});
  });

  it("yields content before match and replacement when complete match found", () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "Hello ", match: false },
      { content: "OLD", match: true },
      { content: " world", match: false }
    );

    const processor = new StaticReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: "NEW"
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["Hello ", "NEW", " world"]);
    expect(mockStrategy.processChunk).toHaveBeenCalledWith(mockInput, {});
  });

  it("handles multiple replacements in single chunk", () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "Hello ", match: false },
      { content: "OLD", match: true },
      { content: " ", match: false },
      { content: "OLD", match: true },
      { content: " world", match: false }
    );

    const processor = new StaticReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: "NEW"
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["Hello ", "NEW", " ", "NEW", " world"]);
    expect(mockStrategy.processChunk).toHaveBeenCalledWith(mockInput, {});
  });

  it("buffers incomplete match at chunk boundary", () => {
    const mockStrategy = mockSearchStrategyFactory({
      content: "Hello wor",
      match: false
    });
    mockStrategy.flush.mockReturnValue("ld");

    const processor = new StaticReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: "NEW"
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["Hello wor"]);
    expect(processor.flush()).toBe("ld");
    expect(mockStrategy.processChunk).toHaveBeenCalledWith(mockInput, {});
    expect(mockStrategy.flush).toHaveBeenCalledWith({});
  });

  it("handles replacement at start of chunk", () => {
    const mockStrategy = mockSearchStrategyFactory(
      { content: "Hello", match: true },
      { content: " world", match: false }
    );

    const processor = new StaticReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: "NEW"
    });

    const outputChunks: string[] = [];
    for (const chunk of processor.processChunk(mockInput)) {
      outputChunks.push(chunk);
    }

    expect(outputChunks).toEqual(["NEW", " world"]);
    expect(mockStrategy.processChunk).toHaveBeenCalledWith(mockInput, {});
  });

  describe("flush", () => {
    it("returns buffered content", () => {
      const mockStrategy = mockSearchStrategyFactory({
        content: "test ",
        match: false
      });
      mockStrategy.flush.mockReturnValue("input");

      const processor = new StaticReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: "NEW"
      });

      const outputChunks: string[] = [];
      for (const chunk of processor.processChunk(mockInput)) {
        outputChunks.push(chunk);
      }

      const flushed = processor.flush();
      expect(flushed).toBe("input");
      expect(mockStrategy.processChunk).toHaveBeenCalledWith(mockInput, {});
      expect(mockStrategy.flush).toHaveBeenCalledWith({});
    });
  });
});
