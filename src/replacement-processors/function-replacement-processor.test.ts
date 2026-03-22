import { describe, it, expect, vi } from "vitest";
import { FunctionReplacementProcessor } from "./function-replacement-processor.ts";
import { mockSearchStrategyFactory } from "../../test/utilities.ts";

describe("FunctionReplacementProcessor", () => {
  describe("processChunk", () => {
    it("yields input directly when search strategy finds no match", () => {
      const mockStrategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "test input"
      });

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: () => "NEW"
      });

      const outputChunks: string[] = [];
      for (const chunk of processor.processChunk("test input")) {
        outputChunks.push(chunk);
      }

      expect(outputChunks).toEqual(["test input"]);
      expect(mockStrategy.processChunk).toHaveBeenCalledWith("test input", {});
    });

    it("yields content before match and replacement when complete match found", () => {
      const mockStrategy = mockSearchStrategyFactory(
        { isMatch: false, content: "Hello " },
        { isMatch: true, content: "OLD", startIndex: 6, endIndex: 9 },
        { isMatch: false, content: " world" }
      );

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: () => "NEW"
      });

      const outputChunks: string[] = [];
      for (const chunk of processor.processChunk("Hello OLD world")) {
        outputChunks.push(chunk);
      }

      expect(outputChunks).toEqual(["Hello ", "NEW", " world"]);
      expect(mockStrategy.processChunk).toHaveBeenCalledWith(
        "Hello OLD world",
        {}
      );
    });

    it("buffers incomplete match and yields nothing", () => {
      const mockStrategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "text "
      });

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: () => "NEW"
      });

      const outputChunks: string[] = [];
      for (const chunk of processor.processChunk("text OL")) {
        outputChunks.push(chunk);
      }

      expect(outputChunks).toEqual(["text "]);
      expect(mockStrategy.processChunk).toHaveBeenCalledWith("text OL", {});
    });

    it("combines buffered content with new chunk on subsequent call", () => {
      // This test verifies that the processor properly handles multi-chunk scenarios
      // where the strategy buffers partial matches across chunks.
      // In practice, a real strategy would buffer "OL" and not yield it until
      // the next chunk confirms or denies the match.

      let callCount = 0;
      const mockStrategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          callCount++;
          if (callCount === 1) {
            // First chunk: yield non-match content before buffered partial
            yield { isMatch: false, content: "text " };
            // "OL" is buffered (not yielded)
          } else if (callCount === 2) {
            // Second chunk completes the match
            yield { isMatch: true, content: "OLD" };
            yield { isMatch: false, content: " end" };
          }
        }),
        flush: vi.fn().mockReturnValue("")
      };

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: () => "NEW"
      });

      const outputChunks: string[] = [];

      for (const chunk of processor.processChunk("text OL")) {
        outputChunks.push(chunk);
      }

      for (const chunk of processor.processChunk("D end")) {
        outputChunks.push(chunk);
      }

      expect(outputChunks).toEqual(["text ", "NEW", " end"]);
    });

    it("calls replacement function with matched content, index, startIndex and endIndex", () => {
      const mockStrategy = mockSearchStrategyFactory(
        { isMatch: false, content: "Hello " },
        { isMatch: true, content: "MATCH", startIndex: 6, endIndex: 11 },
        { isMatch: false, content: " world" }
      );

      const replacementFn = vi.fn().mockReturnValue("RESULT");

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: replacementFn
      });

      const outputChunks: string[] = [];
      for (const chunk of processor.processChunk("Hello MATCH world")) {
        outputChunks.push(chunk);
      }

      expect(replacementFn).toHaveBeenCalledWith("MATCH", 0, 6, 11);
      expect(outputChunks).toEqual(["Hello ", "RESULT", " world"]);
    });

    it("increments match index for subsequent matches", () => {
      let callCount = 0;
      const mockStrategy = {
        createState: vi.fn().mockReturnValue({}),
        processChunk: vi.fn().mockImplementation(function* () {
          callCount++;
          if (callCount === 1) {
            yield { isMatch: true, content: "MATCH", startIndex: 0, endIndex: 5 };
          } else if (callCount === 2) {
            yield { isMatch: true, content: "MATCH", startIndex: 10, endIndex: 15 };
          }
        }),
        flush: vi.fn().mockReturnValue("")
      };

      const replacementFn = vi.fn().mockReturnValue("NEW");

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: replacementFn
      });

      const outputChunks: string[] = [];

      for (const chunk of processor.processChunk("MATCH")) {
        outputChunks.push(chunk);
      }
      for (const chunk of processor.processChunk("MATCH")) {
        outputChunks.push(chunk);
      }

      expect(replacementFn).toHaveBeenNthCalledWith(1, "MATCH", 0, 0, 5);
      expect(replacementFn).toHaveBeenNthCalledWith(2, "MATCH", 1, 10, 15);
    });

    it("continues processing after match to find subsequent matches", () => {
      const mockStrategy = mockSearchStrategyFactory(
        { isMatch: true, content: "OLD", startIndex: 0, endIndex: 3 },
        { isMatch: false, content: " and " },
        { isMatch: true, content: "OLD", startIndex: 8, endIndex: 11 }
      );

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: () => "NEW"
      });

      const outputChunks: string[] = [];
      for (const chunk of processor.processChunk("OLD and OLD")) {
        outputChunks.push(chunk);
      }

      expect(outputChunks).toEqual(["NEW", " and ", "NEW"]);
    });

    it("when using an async replacement function, does not await each async call before proceeding, if the consumer iterates without awaiting", async () => {
      const resolves: ((value: string) => void)[] = [];
      const asyncReplacementFn = vi.fn().mockImplementation(() => {
        const { promise, resolve } = Promise.withResolvers<string>();
        resolves.push(resolve);
        return promise;
      });

      const mockStrategy = mockSearchStrategyFactory(
        { isMatch: true, content: "OLD", startIndex: 0, endIndex: 3 },
        { isMatch: false, content: " and " },
        { isMatch: true, content: "OLD", startIndex: 8, endIndex: 11 }
      );

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: asyncReplacementFn
      });

      const results: IteratorResult<Promise<string> | string>[] = [];
      const iterable = processor.processChunk("OLD and OLD");
      for (const value of [iterable.next(), iterable.next(), iterable.next()]) {
        results.push(value);
      }

      expect(asyncReplacementFn).toHaveBeenCalledTimes(2);
      resolves[0]("NEW 0");
      await expect(results[0].value).resolves.toEqual("NEW 0");
      expect(results[1].value).toEqual(" and ");
      resolves[1]("NEW 1");
      await expect(results[2].value).resolves.toEqual("NEW 1");
    });
  });

  describe("flush", () => {
    it("returns buffered content when called", () => {
      const mockStrategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "text "
      });
      mockStrategy.flush = vi.fn().mockReturnValue("OL");

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: () => "NEW"
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty -- just processing to create buffer
      for (const _chunk of processor.processChunk("text OL")) {
      }

      const flushed = processor.flush();
      expect(flushed).toBe("OL");
      expect(mockStrategy.flush).toHaveBeenCalled();
    });

    it("returns empty string when no buffered content", () => {
      const mockStrategy = mockSearchStrategyFactory({
        isMatch: false,
        content: "test"
      });
      mockStrategy.flush = vi.fn().mockReturnValue("");

      const processor = new FunctionReplacementProcessor({
        searchStrategy: mockStrategy,
        replacement: () => "NEW"
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty -- just processing
      for (const _chunk of processor.processChunk("test")) {
      }

      const flushed = processor.flush();
      expect(flushed).toBe("");
      expect(mockStrategy.flush).toHaveBeenCalled();
    });
  });
});
