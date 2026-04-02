import { describe, it, expect } from "vitest";
import { AsyncReplaceContentTransform } from "./async-transform";
import { Writable } from "node:stream";
import { mockAsyncProcessorFactory } from "../../../test/utilities";

describe("ReplaceContentTransform (async)", () => {
  it("delegates to processor and writes output to stream", async () => {
    const mockProcessor = mockAsyncProcessorFactory("ABC", "abc!");

    const transform = new AsyncReplaceContentTransform(mockProcessor);
    const outputs: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        outputs.push(chunk.toString());
        callback();
      }
    });

    transform.pipe(writable);
    transform.write("abc");
    await new Promise((resolve) => transform.end(resolve));

    expect(outputs).toContain("ABC");
    expect(outputs).toContain("abc!");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("abc");
  });

  it("flush writes flushed content to stream", async () => {
    const mockProcessor = mockAsyncProcessorFactory();

    const transform = new AsyncReplaceContentTransform(mockProcessor);
    const outputs: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        outputs.push(chunk.toString());
        callback();
      }
    });

    transform.pipe(writable);
    transform.write("irrelevant");
    await new Promise((resolve) => transform.end(resolve));

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });
});
