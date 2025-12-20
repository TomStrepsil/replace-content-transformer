import { describe, it, expect } from "vitest";
import { AsyncReplaceContentTransformer } from "./async-transformer.ts";
import {
  mockTransformStreamDefaultControllerFactory,
  mockAsyncProcessorFactory
} from "../../../test/utilities.ts";

describe("ReplaceContentTransformer (async)", () => {
  it("delegates to processor and enqueues output", async () => {
    const mockProcessor = mockAsyncProcessorFactory("ABC", "abc!");

    const transformer = new AsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    await transformer.transform("abc", controller);

    expect(outputs).toContain("ABC");
    expect(outputs).toContain("abc!");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("abc");
  });

  it("skips processing when abort signal is set prior to transformation", async () => {
    const mockProcessor = mockAsyncProcessorFactory("transformed");
    const abortController = new AbortController();
    const transformer = new AsyncReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);
    abortController.abort();

    await transformer.transform("input", controller);

    expect(outputs).toEqual(["input"]);
    expect(mockProcessor.processChunk).not.toHaveBeenCalled();
  });

  it("stops processing mid-transformation when abort signal is set", async () => {
    const abortController = new AbortController();
    const mockProcessor = mockAsyncProcessorFactory(() => {
      abortController.abort();
      return "PART1";
    }, "PART2");
    const transformer = new AsyncReplaceContentTransformer(
      mockProcessor,
      abortController.signal
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    await transformer.transform("input", controller);

    expect(outputs).toContain("PART1");
    expect(outputs).not.toContain("PART2");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
  });

  it("flush enqueues flushed content", () => {
    const mockProcessor = mockAsyncProcessorFactory();

    const transformer = new AsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.flush(controller);

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });
});
