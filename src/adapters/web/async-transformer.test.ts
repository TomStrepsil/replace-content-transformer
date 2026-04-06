import { describe, it, expect } from "vitest";
import { AsyncReplaceContentTransformer } from "./async-transformer.ts";
import {
  mockTransformStreamDefaultControllerFactory,
  mockAsyncProcessorFactory
} from "../../../test/utilities.ts";

describe("AsyncReplaceContentTransformer", () => {
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

  it("stops processing mid-transformation when abort signal is set, and flushes remaining content", async () => {
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

    expect(outputs).toEqual(["PART1", "<FLUSHED>"]);
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("input");
    expect(mockProcessor.flush).toHaveBeenCalledTimes(1);
  });

  it("enqueues content when flush is called", () => {
    const mockProcessor = mockAsyncProcessorFactory();

    const transformer = new AsyncReplaceContentTransformer(mockProcessor);
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    transformer.flush(controller);

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });

  it("stops enqueuing mid-transformation at next yield boundary when cancelled", async () => {
    const transformer = new AsyncReplaceContentTransformer(
      mockAsyncProcessorFactory("PART1", "PART2", "PART3")
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory(outputs);

    controller.enqueue = vi.fn().mockImplementation((chunk: string) => {
      outputs.push(chunk);
      if (chunk === "PART1") {
        transformer.cancel();
      }
    });

    await transformer.transform!("input", controller);

    expect(outputs).toEqual(["PART1"]);
  });

  it.each([undefined, "test reason"])(
    "stops processing before transform when cancelled",
    async (reason) => {
      const mockProcessor = mockAsyncProcessorFactory("OUTPUT");
      const transformer = new AsyncReplaceContentTransformer(mockProcessor);
      const outputs: string[] = [];
      const controller = mockTransformStreamDefaultControllerFactory(outputs);

      transformer.cancel(reason);
      await transformer.transform!("input", controller);

      expect(outputs).toEqual([]);
      expect(mockProcessor.processChunk).not.toHaveBeenCalled();
    }
  );
});
