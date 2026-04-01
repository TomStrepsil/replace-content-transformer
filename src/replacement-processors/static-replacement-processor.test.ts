import { describe, it, expect } from "vitest";
import { createMockSearchStrategy } from "../../test/utilities.ts";
import { createStaticReplacementProcessor, StaticReplacementProcessor } from "./static-replacement-processor.ts";

describe("StaticReplacementProcessor", () => {
  const mockInput = "test input";

  it("yields input directly when search strategy finds no match", () => {
    const mockStrategy = createMockSearchStrategy({
      isMatch: false,
      content: "test output"
    });

    const processor = createStaticReplacementProcessor({
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
    const mockStrategy = createMockSearchStrategy(
      { isMatch: false, content: "Hello " },
      { isMatch: true, content: "OLD" },
      { isMatch: false, content: " world" }
    );

    const processor = createStaticReplacementProcessor({
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
    const mockStrategy = createMockSearchStrategy(
      { isMatch: false, content: "Hello " },
      { isMatch: true, content: "OLD" },
      { isMatch: false, content: " " },
      { isMatch: true, content: "OLD" },
      { isMatch: false, content: " world" }
    );

    const processor = createStaticReplacementProcessor({
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
    const mockStrategy = createMockSearchStrategy({
      isMatch: false,
      content: "Hello wor"
    });
    mockStrategy.flush.mockReturnValue("ld");

    const processor = createStaticReplacementProcessor({
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
    const mockStrategy = createMockSearchStrategy(
      { isMatch: true, content: "Hello" },
      { isMatch: false, content: " world" }
    );

    const processor = createStaticReplacementProcessor({
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
      const mockStrategy = createMockSearchStrategy({
        isMatch: false,
        content: "test "
      });
      mockStrategy.flush.mockReturnValue("input");

      const processor = createStaticReplacementProcessor({
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

  it("should support deprecated constructor syntax", () => {
    const mockStrategy = createMockSearchStrategy(
      { isMatch: true, content: "OLD" }
    );
    const processor = new StaticReplacementProcessor({
      searchStrategy: mockStrategy,
      replacement: "NEW"
    });
    const outputChunks = [...processor.processChunk("OLD")];
    expect(outputChunks).toEqual(["NEW"]);
  });
});
