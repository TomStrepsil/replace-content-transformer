import { describe, it, expect, vi } from "vitest";
import {
  createAsyncReplaceContentTransformer,
  AsyncReplaceContentTransformer,
} from "./async-transformer.ts";
import {
  createMockTransformStreamDefaultController,
  createMockAsyncProcessor
} from "../../../test/utilities.ts";

describe("AsyncReplaceContentTransformer", () => {
  it("delegates to processor and enqueues output", async () => {
    const mockProcessor = createMockAsyncProcessor("ABC", "abc!");

    const transformer = createAsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = createMockTransformStreamDefaultController(outputs);

    await transformer.transform!("abc", controller);

    expect(outputs).toContain("ABC");
    expect(outputs).toContain("abc!");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("abc");
  });

  it("skips processing when abort signal is set prior to transformation", async () => {
    const mockProcessor = createMockAsyncProcessor("transformed");
    const abortController = new AbortController();
    const transformer = createAsyncReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = createMockTransformStreamDefaultController(outputs);
    abortController.abort();

    await transformer.transform!("input", controller);

    expect(outputs).toEqual(["input"]);
    expect(mockProcessor.processChunk).not.toHaveBeenCalled();
  });

  it("stops processing mid-transformation when abort signal is set", async () => {
    const abortController = new AbortController();
    const mockProcessor = createMockAsyncProcessor(() => {
      abortController.abort();
      return "PART1";
    }, "PART2");
    const transformer = createAsyncReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = createMockTransformStreamDefaultController(outputs);

    await transformer.transform!("input", controller);

    expect(outputs).toContain("PART1");
    expect(outputs).not.toContain("PART2");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
  });

  it("flush enqueues flushed content", () => {
    const mockProcessor = createMockAsyncProcessor();

    const transformer = createAsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = createMockTransformStreamDefaultController(outputs);

    transformer.flush!(controller);

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });

  it("cancel stops enqueuing mid-transformation at next yield boundary", async () => {
    const transformer = createAsyncReplaceContentTransformer(
      createMockAsyncProcessor("PART1", "PART2", "PART3")
    );
    const outputs: string[] = [];
    const controller = createMockTransformStreamDefaultController(outputs);

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
    const mockProcessor = createMockAsyncProcessor("OUTPUT");
    const transformer = createAsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = createMockTransformStreamDefaultController(outputs);

    transformer.cancel!("test");
    await transformer.transform!("input", controller);

    expect(outputs).toEqual([]);
    expect(mockProcessor.processChunk).toHaveBeenCalled();
  });

  it("supports deprecated constructor syntax with factory-equivalent behavior", async () => {
    const legacyProcessor = createMockAsyncProcessor("ABC", "abc!");
    const factoryProcessor = createMockAsyncProcessor("ABC", "abc!");
    const legacyTransformer = new AsyncReplaceContentTransformer(legacyProcessor);
    const factoryTransformer = createAsyncReplaceContentTransformer(factoryProcessor);
    const legacyOutputs: string[] = [];
    const factoryOutputs: string[] = [];
    const legacyController =
      createMockTransformStreamDefaultController(legacyOutputs);
    const factoryController =
      createMockTransformStreamDefaultController(factoryOutputs);

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
