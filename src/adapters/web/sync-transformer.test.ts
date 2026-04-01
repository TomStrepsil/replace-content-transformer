import { describe, it, expect } from "vitest";
import {
  createReplaceContentTransformer,
  ReplaceContentTransformer,
} from "./sync-transformer.ts";
import {
  mockTransformStreamDefaultControllerFactory,
  mockSyncProcessorFactory
} from "../../../test/utilities.ts";

describe("ReplaceContentTransformer", () => {
  it("delegates to processor and enqueues output", () => {
    const mockProcessor = mockSyncProcessorFactory("ABC", "abc!");
    const transformer = createReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.transform!("abc", controller);

    expect(outputs).toContain("ABC");
    expect(outputs).toContain("abc!");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("abc");
  });

  it("skips processing when abort signal is set prior to transformation", () => {
    const mockProcessor = mockSyncProcessorFactory("transformed");
    const abortController = new AbortController();
    const transformer = createReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);
    abortController.abort();

    transformer.transform!("input", controller);

    expect(outputs).toEqual(["input"]);
    expect(mockProcessor.processChunk).not.toHaveBeenCalled();
  });

  it("stops processing mid-transformation when abort signal is set", () => {
    const abortController = new AbortController();
    const mockProcessor = mockSyncProcessorFactory(() => {
      abortController.abort();
      return "PART1";
    }, "PART2");
    const transformer = createReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.transform!("input", controller);

    expect(outputs).toContain("PART1");
    expect(outputs).not.toContain("PART2");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
  });

  it("flush enqueues flushed content", () => {
    const mockProcessor = mockSyncProcessorFactory();

    const transformer = createReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.flush!(controller);

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });

  it("supports Promise<string> generic type for async replacement functions", async () => {
    const mockProcessor = mockSyncProcessorFactory<Promise<string> | string>(
      Promise.resolve("ASYNC_RESULT_1"),
      "regular string",
      Promise.resolve("ASYNC_RESULT_2")
    );

    const transformer = createReplaceContentTransformer<Promise<string>>(
      mockProcessor
    );
    const outputs: Array<string | Promise<string>> = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.transform!("input", controller);

    expect(outputs).toHaveLength(3);
    expect(outputs[0]).toBeInstanceOf(Promise);
    expect(outputs[1]).toBe("regular string");
    expect(outputs[2]).toBeInstanceOf(Promise);

    // Resolve promises
    await expect(outputs[0]).resolves.toBe("ASYNC_RESULT_1");
    await expect(outputs[2]).resolves.toBe("ASYNC_RESULT_2");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
  });

  it("does not expose cancel", () => {
    const transformer = createReplaceContentTransformer(
      mockSyncProcessorFactory()
    );

    expect("cancel" in transformer).toBe(false);
  });

  it("supports deprecated constructor syntax with factory-equivalent behavior", () => {
    const legacyProcessor = mockSyncProcessorFactory("ABC", "abc!");
    const factoryProcessor = mockSyncProcessorFactory("ABC", "abc!");
    const legacyTransformer = new ReplaceContentTransformer(legacyProcessor);
    const factoryTransformer = createReplaceContentTransformer(factoryProcessor);
    const legacyOutputs: string[] = [];
    const factoryOutputs: string[] = [];
    const legacyController =
      mockTransformStreamDefaultControllerFactory(legacyOutputs);
    const factoryController =
      mockTransformStreamDefaultControllerFactory(factoryOutputs);

    legacyTransformer.transform("abc", legacyController);
    factoryTransformer.transform!("abc", factoryController);
    legacyTransformer.flush(legacyController);
    factoryTransformer.flush!(factoryController);

    expect(factoryOutputs).toEqual(legacyOutputs);
    expect(legacyProcessor.processChunk).toHaveBeenCalledWith("abc");
    expect(factoryProcessor.processChunk).toHaveBeenCalledWith("abc");
  });
});
