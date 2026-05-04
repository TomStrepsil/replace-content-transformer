import { describe, it, expect } from "vitest";
import { ReplaceContentTransformer } from "./sync-transformer.js";
import {
  mockTransformStreamDefaultControllerFactory,
  mockSyncProcessorFactory
} from "../../../test/utilities.js";

describe("ReplaceContentTransformer (sync)", () => {
  it("delegates to processor and enqueues output", () => {
    const mockProcessor = mockSyncProcessorFactory("ABC", "abc!");
    const transformer = new ReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.transform("abc", controller);

    expect(outputs).toContain("ABC");
    expect(outputs).toContain("abc!");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("abc");
  });

  it("skips processing when abort signal is set prior to transformation", () => {
    const mockProcessor = mockSyncProcessorFactory("transformed");
    const abortController = new AbortController();
    const transformer = new ReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);
    abortController.abort();

    transformer.transform("input", controller);

    expect(outputs).toEqual(["input"]);
    expect(mockProcessor.processChunk).not.toHaveBeenCalled();
  });

  it("stops processing mid-transformation when abort signal is set, and flushes remaining content", () => {
    const abortController = new AbortController();
    const mockProcessor = mockSyncProcessorFactory(() => {
      abortController.abort();
      return "PART1";
    }, "PART2");
    mockProcessor.flush.mockReturnValue("<FLUSHED>");
    const transformer = new ReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.transform("input", controller);

    expect(outputs).toEqual(["PART1", "<FLUSHED>"]);
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
    expect(mockProcessor.flush).toHaveBeenCalledTimes(1);
  });

  it("flushes at most once after abort across multiple subsequent chunks", () => {
    const mockProcessor = mockSyncProcessorFactory("OUT");
    const abortController = new AbortController();
    const transformer = new ReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    abortController.abort();
    transformer.transform("first", controller);
    transformer.transform("second", controller);

    expect(outputs).toEqual(["first", "second"]);
    expect(mockProcessor.processChunk).not.toHaveBeenCalled();
  });

  it("flush enqueues flushed content", () => {
    const mockProcessor = mockSyncProcessorFactory();

    const transformer = new ReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);
    mockProcessor.flush.mockReturnValue("<FLUSHED>");

    transformer.flush(controller);

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });
});
