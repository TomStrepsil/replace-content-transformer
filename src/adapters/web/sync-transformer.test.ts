import { describe, it, expect } from "vitest";
import { ReplaceContentTransformer } from "./sync-transformer.ts";
import {
  mockTransformStreamDefaultControllerFactory,
  mockSyncProcessorFactory
} from "../../../test/utilities.ts";

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

  it("stops processing mid-transformation when abort signal is set", () => {
    const abortController = new AbortController();
    const mockProcessor = mockSyncProcessorFactory(() => {
      abortController.abort();
      return "PART1";
    }, "PART2");
    const transformer = new ReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.transform("input", controller);

    expect(outputs).toContain("PART1");
    expect(outputs).not.toContain("PART2");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
  });

  it("flush enqueues flushed content", () => {
    const mockProcessor = mockSyncProcessorFactory();

    const transformer = new ReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.flush(controller);

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });

  it("supports Promise<string> generic type for async replacement functions", async () => {
    const mockProcessor = mockSyncProcessorFactory<Promise<string> | string>(
      Promise.resolve("ASYNC_RESULT_1"),
      "regular string",
      Promise.resolve("ASYNC_RESULT_2")
    );

    const transformer = new ReplaceContentTransformer<Promise<string>>(
      mockProcessor
    );
    const outputs: Array<string | Promise<string>> = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.transform("input", controller);

    expect(outputs).toHaveLength(3);
    expect(outputs[0]).toBeInstanceOf(Promise);
    expect(outputs[1]).toBe("regular string");
    expect(outputs[2]).toBeInstanceOf(Promise);

    // Resolve promises
    await expect(outputs[0]).resolves.toBe("ASYNC_RESULT_1");
    await expect(outputs[2]).resolves.toBe("ASYNC_RESULT_2");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
  });
});
