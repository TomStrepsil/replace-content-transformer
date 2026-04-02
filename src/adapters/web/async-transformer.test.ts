import { describe, it, expect, vi } from "vitest";
import {
  createAsyncReplaceContentTransformer,
  AsyncReplaceContentTransformer,
} from "./async-transformer.ts";
import {
  mockTransformStreamDefaultControllerFactory,
  mockAsyncProcessorFactory
} from "../../../test/utilities.ts";

describe("AsyncReplaceContentTransformer", () => {
  it("delegates to processor and enqueues output", async () => {
    const mockProcessor = mockAsyncProcessorFactory("ABC", "abc!");

    const transformer = createAsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    await transformer.transform!("abc", controller);

    expect(outputs).toContain("ABC");
    expect(outputs).toContain("abc!");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("abc");
  });

  it("skips processing when abort signal is set prior to transformation", async () => {
    const mockProcessor = mockAsyncProcessorFactory("transformed");
    const abortController = new AbortController();
    const transformer = createAsyncReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);
    abortController.abort();

    await transformer.transform!("input", controller);

    expect(outputs).toEqual(["input"]);
    expect(mockProcessor.processChunk).not.toHaveBeenCalled();
  });

  it("stops processing mid-transformation when abort signal is set", async () => {
    const abortController = new AbortController();
    const mockProcessor = mockAsyncProcessorFactory(() => {
      abortController.abort();
      return "PART1";
    }, "PART2");
    const transformer = createAsyncReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    await transformer.transform!("input", controller);

    expect(outputs).toContain("PART1");
    expect(outputs).not.toContain("PART2");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
  });

  it("flush enqueues flushed content", () => {
    const mockProcessor = mockAsyncProcessorFactory();

    const transformer = createAsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.flush!(controller);

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });

  it("cancel stops enqueuing mid-transformation at next yield boundary", async () => {
    const transformer = createAsyncReplaceContentTransformer(
      mockAsyncProcessorFactory("PART1", "PART2", "PART3")
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    controller.enqueue = vi.fn().mockImplementation((chunk: string) => {
      outputs.push(chunk);
      if (chunk === "PART1") {
        transformer.cancel!("test");
      }
    });

    await transformer.transform!("input", controller);

    expect(outputs).toEqual(["PART1"]);
  });

  it("cancel before transform prevents processing", async () => {
    const mockProcessor = mockAsyncProcessorFactory("OUTPUT");
    const transformer = createAsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.cancel!("test");
    await transformer.transform!("input", controller);

    expect(outputs).toEqual([]);
    expect(mockProcessor.processChunk).toHaveBeenCalled();
  });

  it("supports deprecated constructor syntax with factory-equivalent behavior", async () => {
    const legacyProcessor = mockAsyncProcessorFactory("ABC", "abc!");
    const factoryProcessor = mockAsyncProcessorFactory("ABC", "abc!");
    const legacyTransformer = new AsyncReplaceContentTransformer(legacyProcessor);
    const factoryTransformer = createAsyncReplaceContentTransformer(factoryProcessor);
    const legacyOutputs: string[] = [];
    const factoryOutputs: string[] = [];
    const legacyController =
      mockTransformStreamDefaultControllerFactory(legacyOutputs);
    const factoryController =
      mockTransformStreamDefaultControllerFactory(factoryOutputs);

    await legacyTransformer.transform("abc", legacyController);
    await factoryTransformer.transform!("abc", factoryController);
    legacyTransformer.flush(legacyController);
    factoryTransformer.flush!(factoryController);

    expect(typeof legacyTransformer.cancel).toBe("function");
    expect(factoryOutputs).toEqual(legacyOutputs);
    expect(legacyProcessor.processChunk).toHaveBeenCalledWith("abc");
    expect(factoryProcessor.processChunk).toHaveBeenCalledWith("abc");
  });
});
