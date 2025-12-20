import { describe, it, expect, vi } from "vitest";
import { ReplaceContentTransformer } from "./sync-transformer.ts";
import { FunctionReplacementProcessor } from "../../replacement-processors/function-replacement-processor.ts";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.ts";

describe("ReplaceContentTransformer + StringAnchorSearchStrategy + Promise-returning FunctionReplacementProcessor", () => {
  it("should handle promises returned by replacement function", async () => {
    vi.useFakeTimers();

    const searchStrategy = new StringAnchorSearchStrategy(["{{", "}}"]);

    const processor = new FunctionReplacementProcessor<Promise<string>>({
      searchStrategy,
      replacement: async (match: string, index: number): Promise<string> => {
        await vi.waitFor(() => Promise.resolve(), { timeout: 10 });
        return `[${index}:${match.slice(2, -2)}]`;
      }
    });

    const transformer = new ReplaceContentTransformer<Promise<string>>(
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
    const processor = new FunctionReplacementProcessor<Promise<string>>({
      searchStrategy,
      replacement: (): Promise<string> => {
        callCount++;
        return callCount === 1 ? firstPromise : secondPromise;
      }
    });

    const transformer = new ReplaceContentTransformer<Promise<string>>(
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
