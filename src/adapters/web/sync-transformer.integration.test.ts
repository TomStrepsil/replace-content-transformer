import { describe, it, expect } from "vitest";
import { text } from "node:stream/consumers";
import { ReplaceContentTransformer } from "./sync-transformer";
import { FunctionReplacementProcessor } from "../../replacement-processors/function-replacement-processor";
import { StringAnchorSearchStrategy } from "../../search-strategies/index";
import type { ReplacementContext } from "../../replacement-processors/replacement-processor.base";

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

describe("ReplaceContentTransformer + StringAnchorSearchStrategy + Promise-returning FunctionReplacementProcessor", () => {
  it("should handle promises returned by replacement function", async () => {
    vi.useFakeTimers();

    const searchStrategy = new StringAnchorSearchStrategy(["{{", "}}"]);

    const processor = new FunctionReplacementProcessor({
      searchStrategy,
      replacement: async (match: string, { matchIndex }: ReplacementContext): Promise<string> => {
        await vi.waitFor(() => Promise.resolve(), { timeout: 10 });
        return `[${matchIndex}:${match.slice(2, -2)}]`;
      }
    });

    const transformer = new ReplaceContentTransformer(
      processor
    );

    const input = "Hello {{world}} and {{universe}}!";
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(input));
        controller.close();
      }
    });
    const transformed = readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream(transformer));

    const reader = transformed.getReader();
    const chunks: (string | Promise<string>)[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks.length).toBeGreaterThan(0);

    const resolvedChunks = await Promise.all(
      chunks.map((chunk) =>
        chunk instanceof Promise ? chunk : Promise.resolve(chunk)
      )
    );

    const result = resolvedChunks.join("");
    expect(result).toBe("Hello [0:world] and [1:universe]!");

    vi.useRealTimers();
  });

  it("should verify that promises are actually yielded (not awaited by transformer)", async () => {
    vi.useFakeTimers();
    const searchStrategy = new StringAnchorSearchStrategy(["{{", "}}"]);

    let resolveFirst: (value: string) => void;
    let resolveSecond: (value: string) => void;

    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    let callCount = 0;
    const processor = new FunctionReplacementProcessor({
      searchStrategy,
      replacement: (): Promise<string> => {
        callCount++;
        return callCount === 1 ? firstPromise : secondPromise;
      }
    });

    const transformer = new ReplaceContentTransformer(
      processor
    );

    const input = "{{A}} and {{B}}";
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(input));
        controller.close();
      }
    });

    const transformed = readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream(transformer));

    const reader = transformed.getReader();
    const chunks: (string | Promise<string>)[] = [];

    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    })();

    await vi.advanceTimersByTimeAsync(50);

    expect(callCount).toBe(2);

    resolveFirst!("FIRST");
    resolveSecond!("SECOND");

    await readPromise;

    const resolvedChunks = await Promise.all(
      chunks.map((chunk) =>
        chunk instanceof Promise ? chunk : Promise.resolve(chunk)
      )
    );

    const result = resolvedChunks.join("");
    expect(result).toBe("FIRST and SECOND");

    vi.useRealTimers();
  });
});
