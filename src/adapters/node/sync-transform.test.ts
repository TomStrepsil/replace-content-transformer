import { describe, it, expect } from "vitest";
import { ReplaceContentTransform } from "./sync-transform.ts";
import { Writable } from "node:stream";
import { mockSyncProcessorFactory } from "../../../test/utilities.ts";

describe("ReplaceContentTransform (sync)", () => {
  it("delegates to processor and writes output to stream", () => {
    const mockProcessor = mockSyncProcessorFactory("ABC", "abc!");

    const transform = new ReplaceContentTransform(mockProcessor);
    const outputs: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        outputs.push(chunk.toString());
        callback();
      }
    });

    transform.pipe(writable);
    transform.write("abc");
    transform.end();

    expect(outputs).toContain("ABC");
    expect(outputs).toContain("abc!");
    expect(mockProcessor.processChunk).toHaveBeenCalledWith("abc");
  });

  it("flush writes flushed content to stream", () => {
    const mockProcessor = mockSyncProcessorFactory();

    const transform = new ReplaceContentTransform(mockProcessor);
    const outputs: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        outputs.push(chunk.toString());
        callback();
      }
    });

    transform.pipe(writable);
    transform.write("irrelevant");
    transform.end();

    expect(outputs).toContain("<FLUSHED>");
    expect(mockProcessor.flush).toHaveBeenCalled();
  });
});
