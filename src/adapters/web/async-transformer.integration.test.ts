import { describe, it, expect } from "vitest";
import { text } from "node:stream/consumers";
import { AsyncSerialReplacementTransformEngine } from "../../engines/async-serial-transform-engine.js";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.js";
import { startTestHttpServer, streamToString } from "../../../test/utilities.js";
import { AsyncReplaceContentTransformer } from "./async-transformer.js";
import { AsyncLookaheadTransformEngine } from "../../engines/async-lookahead-transform-engine/engine.js";
import { SemaphoreStrategy } from "../../engines/async-lookahead-transform-engine/concurrency-strategy/semaphore-strategy.js";
import {
  asyncIterable,
  mockSearchStrategyFactory,
  mockTransformStreamDefaultControllerFactory
} from "../../../test/utilities.js";

describe("AsyncReplaceContentTransformer + AsyncSerialReplacementTransformEngine + StringAnchorSearchStrategy", () => {
  it("passes through new chunks after abort set between chunks when no buffered remainder exists", async () => {
    const abortController = new AbortController();
    const transformer = new AsyncReplaceContentTransformer(
      new AsyncSerialReplacementTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: async (match) => match.toUpperCase(),
        stopReplacingSignal: abortController.signal
      })
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
    const transformer = new AsyncReplaceContentTransformer(
      new AsyncSerialReplacementTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: async (match) => match.toUpperCase(),
        stopReplacingSignal: abortController.signal
      })
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

  it("supports streaming AsyncIterable<string> replacement via HTTP fetch", async () => {
    const httpServer = await startTestHttpServer({
      "/fragment": () => new Response("<h1>some fragment</h1>"),
      "/parent": (request) => {
        const fragmentUrl = new URL("/fragment", request.url).toString();
        return new Response(`<div><esi:include src="${fragmentUrl}" /></div>`);
      }
    });

    try {
      const fetchAndDecode = async (url: string): Promise<AsyncIterable<string>> => {
        const res = await fetch(url);
        return res.body!.pipeThrough(new TextDecoderStream());
      };

      const parentResponse = await fetchAndDecode(`${httpServer.baseUrl}/parent`);

      const result = await streamToString(
        (parentResponse as ReadableStream<string>).pipeThrough(
          new TransformStream(
            new AsyncReplaceContentTransformer(
              new AsyncSerialReplacementTransformEngine({
                searchStrategy: new StringAnchorSearchStrategy([
                  "<esi:include",
                  ">"
                ]),
                replacement: (match) => {
                  const [, url] = /src="([^"]+)"/.exec(match)!;
                  return fetchAndDecode(url);
                }
              })
            )
          )
        )
      );

      expect(result).toEqual("<div><h1>some fragment</h1></div>");
    } finally {
      await httpServer.close();
    }
  });

  it("respects stopReplacingSignal when shared with an async operation", async () => {
    const abortController = new AbortController();

    const httpServer = await startTestHttpServer({
      "/fragment-abort": () => {
        return new Promise<Response>(() => {
          abortController.abort(); // simulate external abort during fetch
        });
      },
      "/parent-abort": (request) => {
        const fragmentUrl = new URL("/fragment-abort", request.url).toString();
        const notAttemptedUrl = new URL(
          "/some-not-attempted-fragment",
          request.url
        ).toString();
        return new Response(
          `<esi:include src="${fragmentUrl}" /><div><esi:include src="${notAttemptedUrl}" /></div>`
        );
      }
    });

    try {
      const fetchAndDecode = async (url: string, signal: AbortSignal): Promise<AsyncIterable<string>> => {
        const res = await fetch(url, { signal });
        return res.body!.pipeThrough(new TextDecoderStream());
      };

      const parentResponse = await fetch(`${httpServer.baseUrl}/parent-abort`);
      const parentStream = parentResponse.body!.pipeThrough(
        new TextDecoderStream()
      );

      const transformer = new AsyncReplaceContentTransformer(
        new AsyncSerialReplacementTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy([
            "<esi:include",
            ">"
          ]),
          replacement: async (match) => {
            const [, url] = /src="([^"]+)"/.exec(match)!;
            try {
              return await fetchAndDecode(url, abortController.signal);
            } catch (error: unknown) {
              if (error instanceof Error && error.name === "AbortError") {
                return (async function* () {
                  yield "<div>Operation Cancelled</div>";
                })();
              }
              throw error;
            }
          },
          stopReplacingSignal: abortController.signal
        })
      );

      const transformedStream = parentStream.pipeThrough(
        new TransformStream(transformer)
      );

      await expect(streamToString(transformedStream)).resolves.toEqual(
        `<div>Operation Cancelled</div><div><esi:include src="${httpServer.baseUrl}/some-not-attempted-fragment" /></div>`
      );
    } finally {
      await httpServer.close();
    }
  });
});

// Engine behaviour (scan/schedule/drain, nested re-scanning, backpressure,
// error forwarding, replacement-arg pass-through) is verified directly in
// `src/lookahead/engine.test.ts`. These tests cover only the adapter wiring:
// mapping the WHATWG Transformer lifecycle onto LookaheadTransformEngine and
// forwarding emissions to the TransformStreamDefaultController.

describe("AsyncReplaceContentTransformer + LookaheadTransformEngine (web adapter)", () => {
  it("forwards engine emissions to controller.enqueue", async () => {
    const strategy = mockSearchStrategyFactory(
      { isMatch: false, content: "a" },
      { isMatch: false, content: "b" }
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory<string>(outputs);

    const transformer = new AsyncReplaceContentTransformer(
      new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => asyncIterable(""),
        concurrencyStrategy: new SemaphoreStrategy(1)
      })
    );

    transformer.start(controller);
    await transformer.transform("ab");
    await transformer.flush();

    expect(outputs.join("")).toBe("ab");
    expect(controller.error).not.toHaveBeenCalled();
  });

  it("forwards engine errors to controller.error and rejects flush()", async () => {
    const strategy = mockSearchStrategyFactory({
      isMatch: true,
      content: "M",
      streamIndices: [0, 1]
    });
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory<string>(outputs);

    const transformer = new AsyncReplaceContentTransformer(
      new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement: async () => {
          throw new Error("boom");
        },
        concurrencyStrategy: new SemaphoreStrategy(1)
      })
    );

    transformer.start(controller);
    await transformer.transform("M");
    await expect(transformer.flush()).rejects.toThrow("boom");
    expect(controller.error).toHaveBeenCalledWith(expect.any(Error));
  });

  it("pipes end-to-end through a real TransformStream", async () => {
    const strategy = mockSearchStrategyFactory(
      { isMatch: false, content: "pre " },
      { isMatch: true, content: "M", streamIndices: [4, 5] },
      { isMatch: false, content: " post" }
    );
    const replacement = vi.fn(async () => asyncIterable("X"));
    const transformer = new AsyncReplaceContentTransformer(
      new AsyncLookaheadTransformEngine({
        searchStrategy: strategy,
        replacement,
        concurrencyStrategy: new SemaphoreStrategy(1)
      })
    );

    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("pre M post");
        controller.close();
      }
    }).pipeThrough(new TransformStream(transformer));

    const chunks: string[] = [];
    for await (const chunk of source) chunks.push(chunk);
    expect(chunks.join("")).toBe("pre X post");
  });
});