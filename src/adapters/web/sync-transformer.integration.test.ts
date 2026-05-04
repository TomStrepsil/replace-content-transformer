import { describe, it, expect } from "vitest";
import { text } from "node:stream/consumers";
import { ReplaceContentTransformer } from "./sync-transformer.js";
import { FunctionReplacementProcessor } from "../../replacement-processors/function-replacement-processor.js";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.js";

describe("ReplaceContentTransformer + StringAnchorSearchStrategy + stopReplacingSignal", () => {
  it("passes through new chunks after abort set between chunks when no buffered remainder exists", async () => {
    const abortController = new AbortController();
    const replacement = (match: string) => match.toUpperCase();
    const transformer = new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement
      }),
      abortController.signal
    );

    const stream = new TransformStream(transformer);
    const writer = stream.writable.getWriter();
    const outputPromise = text(stream.readable);

    await writer.write("plain ");
    abortController.abort();
    await writer.write("text");
    await writer.close();

    await expect(outputPromise).resolves.toBe("plain text");
  });

  it("flushes buffered partial content before passthrough when abort is set between chunks", async () => {
    const abortController = new AbortController();
    const replacement = (match: string) => match.toUpperCase();
    const transformer = new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement
      }),
      abortController.signal
    );

    const stream = new TransformStream(transformer);
    const writer = stream.writable.getWriter();
    const outputPromise = text(stream.readable);

    await writer.write("{{a");
    abortController.abort();
    await writer.write("}} next");
    await writer.close();

    await expect(outputPromise).resolves.toBe("{{a}} next");
  });

  it("flushes the unprocessed remainder of a chunk when abort is signaled mid-transform", async () => {
    const abortController = new AbortController();
    const transformer = new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["{{x}}"]),
        replacement: () => {
          abortController.abort();
          return "REPLACED";
        }
      }),
      abortController.signal
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("{{x}}-tail"));
        controller.enqueue(encoder.encode(" next"));
        controller.close();
      }
    });

    const transformed = readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream(transformer));

    await expect(text(transformed)).resolves.toBe("REPLACED-tail next");
  });

  it("stops discovering additional matches in the current chunk after mid-transform abort", async () => {
    const abortController = new AbortController();
    const replacement = vi
      .fn()
      .mockImplementation((match: string) => {
        abortController.abort();
        return match.toUpperCase();
      });

    const transformer = new ReplaceContentTransformer(
      new FunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement
      }),
      abortController.signal
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("{{a}}{{b}}{{c}}"));
        controller.enqueue(encoder.encode(" next"));
        controller.close();
      }
    });

    const transformed = readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream(transformer));

    await expect(text(transformed)).resolves.toBe("{{A}}{{b}}{{c}} next");
    expect(replacement).toHaveBeenCalledTimes(1);
  });
});
