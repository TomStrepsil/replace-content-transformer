import { describe, it, expect, vi } from "vitest";
import { text } from "node:stream/consumers";
import { ReplaceContentTransformer } from "./transformer.js";
import { SerialTransformEngine } from "../../engines/serial-transform-engine.js";
import { LookaheadTransformEngine, SemaphoreStrategy } from "../../engines/index.js";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.js";
import {
  asyncIterable,
  mockSearchStrategyFactory,
  mockTransformStreamDefaultControllerFactory,
  startTestHttpServer,
  streamToString
} from "../../../test/utilities.js";

describe("ReplaceContentTransformer + SerialTransformEngine + StringAnchorSearchStrategy", () => {
  const replacementKinds = [
    { kind: "synchronous", replacement: (match: string) => match.toUpperCase() },
    { kind: "asynchronous", replacement: async (match: string) => match.toUpperCase() }
  ];

  it.each(replacementKinds)("passes through new chunks after abort set between chunks when no buffered remainder exists ($kind replacement)", async ({ replacement }) => {
    const abortController = new AbortController();
    const transformer = new ReplaceContentTransformer(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement,
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

  it.each(replacementKinds)("flushes buffered partial content before passthrough when abort is set between chunks ($kind replacement)", async ({ replacement }) => {
    const abortController = new AbortController();
    const transformer = new ReplaceContentTransformer(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement,
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

  it("stops discovering additional matches in the current chunk after mid-transform abort", async () => {
    const abortController = new AbortController();
    const replacement = vi
      .fn()
      .mockImplementation((match: string) => {
        abortController.abort();
        return match.toUpperCase();
      });

    const transformer = new ReplaceContentTransformer(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement,
        stopReplacingSignal: abortController.signal
      })
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

  it("emits one chunk per input chunk with a stopReplacingSignal, as no reader sees output before transform() returns", async () => {
    const abortController = new AbortController();
    const replacement = vi.fn((match: string) => match.toUpperCase());
    const stream = new TransformStream(
      new ReplaceContentTransformer(
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: abortController.signal
        })
      )
    );
    const chunks: string[] = [];
    const reading = stream.readable.pipeTo(
      new WritableStream({
        write(chunk) {
          chunks.push(chunk);
          abortController.abort();
        }
      })
    );

    const writer = stream.writable.getWriter();
    await writer.write("x{{a}}y{{b}}z");
    await writer.write("{{c}}");
    await writer.close();
    await reading;

    expect(chunks).toEqual(["x{{A}}y{{B}}z", "{{c}}"]);
    expect(replacement).toHaveBeenCalledTimes(2);
  });

  it("should support streaming ReadableStream into the output", async () => {
    const httpServer = await startTestHttpServer({
      "/fragment": () => new Response("<h1>some fragment</h1>"),
      "/parent": (request) => {
        const fragmentUrl = new URL("/fragment", request.url).toString();
        return new Response(`<div><esi:include src="${fragmentUrl}" /></div>`);
      }
    });

    try {
      const fetchAndDecode = async (url: string) => {
        const res = await fetch(url);
        return res.body!.pipeThrough(new TextDecoderStream());
      };

      const parentResponse = await fetchAndDecode(`${httpServer.baseUrl}/parent`);

      const result = await streamToString(
        parentResponse.pipeThrough(
          new TransformStream(
            new ReplaceContentTransformer(
              new SerialTransformEngine({
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
      const fetchAndDecode = async (url: string, signal: AbortSignal) => {
        const res = await fetch(url, { signal });
        return res.body!.pipeThrough(new TextDecoderStream());
      };

      const parentResponse = await fetch(`${httpServer.baseUrl}/parent-abort`);
      const parentStream = parentResponse.body!.pipeThrough(
        new TextDecoderStream()
      );

      const transformer = new ReplaceContentTransformer(
        new SerialTransformEngine({
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

describe("ReplaceContentTransformer + LookaheadTransformEngine (web adapter)", () => {
  it("forwards engine emissions to controller.enqueue", async () => {
    const strategy = mockSearchStrategyFactory(
      { isMatch: false, content: "a" },
      { isMatch: false, content: "b" }
    );
    const outputs: string[] = [];
    const controller = mockTransformStreamDefaultControllerFactory<string>(outputs);

    const transformer = new ReplaceContentTransformer(
      new LookaheadTransformEngine({
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

    const transformer = new ReplaceContentTransformer(
      new LookaheadTransformEngine({
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
    const transformer = new ReplaceContentTransformer(
      new LookaheadTransformEngine({
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
