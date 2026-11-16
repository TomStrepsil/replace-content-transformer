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
  startTestHttpServer
} from "../../../test/utilities.js";
import {
  byteStreamOf,
  byteWebAdapter,
  everyTwoWayByteSplit,
  textWebAdapter,
  type WebAdapterFamily,
  type WebChunk
} from "../../../test/web-adapters.js";

const replacementKinds = [
  { kind: "synchronous", replacement: (match: string) => match.toUpperCase() },
  { kind: "asynchronous", replacement: async (match: string) => match.toUpperCase() }
];

function describeWebAdapter<C extends WebChunk>(family: WebAdapterFamily<C>) {
  describe(`${family.adapter} + SerialTransformEngine + StringAnchorSearchStrategy`, () => {
    it.each(replacementKinds)("passes through new chunks after abort set between chunks when no buffered remainder exists ($kind replacement)", async ({ replacement }) => {
      const abortController = new AbortController();
      const transformer = family.create(
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: abortController.signal
        })
      );

      const stream = new TransformStream<C, C>(transformer);
      const writer = stream.writable.getWriter();
      const outputPromise = text(stream.readable);

      await writer.write(family.chunkOf("plain "));
      abortController.abort();
      await writer.write(family.chunkOf("text"));
      await writer.close();

      await expect(outputPromise).resolves.toBe("plain text");
    });

    it.each(replacementKinds)("flushes buffered partial content before passthrough when abort is set between chunks ($kind replacement)", async ({ replacement }) => {
      const abortController = new AbortController();
      const transformer = family.create(
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: abortController.signal
        })
      );

      const stream = new TransformStream<C, C>(transformer);
      const writer = stream.writable.getWriter();
      const outputPromise = text(stream.readable);

      await writer.write(family.chunkOf("{{a"));
      abortController.abort();
      await writer.write(family.chunkOf("}} next"));
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

      const transformer = family.create(
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: abortController.signal
        })
      );

      const encoder = new TextEncoder();
      const transformed = family
        .fromBytes(
          byteStreamOf([encoder.encode("{{a}}{{b}}{{c}}"), encoder.encode(" next")])
        )
        .pipeThrough(new TransformStream<C, C>(transformer));

      await expect(text(transformed)).resolves.toBe("{{A}}{{b}}{{c}} next");
      expect(replacement).toHaveBeenCalledTimes(1);
    });

    it("emits one chunk per input chunk with a stopReplacingSignal, as no reader sees output before transform() returns", async () => {
      const abortController = new AbortController();
      const replacement = vi.fn((match: string) => match.toUpperCase());
      const stream = new TransformStream<C, C>(
        family.create(
          new SerialTransformEngine({
            searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
            replacement,
            stopReplacingSignal: abortController.signal
          })
        )
      );
      const chunks: string[] = [];
      const reading = stream.readable.pipeTo(
        new WritableStream<C>({
          write(chunk) {
            chunks.push(family.textOf(chunk));
            abortController.abort();
          }
        })
      );

      const writer = stream.writable.getWriter();
      await writer.write(family.chunkOf("x{{a}}y{{b}}z"));
      await writer.write(family.chunkOf("{{c}}"));
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

        const parentResponse = await fetch(`${httpServer.baseUrl}/parent`);

        const result = await text(
          family.fromBytes(parentResponse.body!).pipeThrough(
            new TransformStream<C, C>(
              family.create(
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

        const transformer = family.create(
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

        const transformedStream = family
          .fromBytes(parentResponse.body!)
          .pipeThrough(new TransformStream<C, C>(transformer));

        await expect(text(transformedStream)).resolves.toEqual(
          `<div>Operation Cancelled</div><div><esi:include src="${httpServer.baseUrl}/some-not-attempted-fragment" /></div>`
        );
      } finally {
        await httpServer.close();
      }
    });
  });

  describe(`${family.adapter} + LookaheadTransformEngine (web adapter)`, () => {
    it("forwards engine emissions to controller.enqueue", async () => {
      const strategy = mockSearchStrategyFactory(
        { isMatch: false, content: "a" },
        { isMatch: false, content: "b" }
      );
      const outputs: C[] = [];
      const controller = mockTransformStreamDefaultControllerFactory(outputs);

      const transformer = family.create(
        new LookaheadTransformEngine({
          searchStrategy: strategy,
          replacement: async () => asyncIterable(""),
          concurrencyStrategy: new SemaphoreStrategy(1)
        })
      );

      transformer.start(controller);
      await transformer.transform(family.chunkOf("ab"));
      await transformer.flush();

      expect(outputs.map(family.textOf).join("")).toBe("ab");
      expect(controller.error).not.toHaveBeenCalled();
    });

    it("forwards engine errors to controller.error and rejects flush()", async () => {
      const strategy = mockSearchStrategyFactory({
        isMatch: true,
        content: "M",
        streamIndices: [0, 1]
      });
      const controller = mockTransformStreamDefaultControllerFactory<C>([]);

      const transformer = family.create(
        new LookaheadTransformEngine({
          searchStrategy: strategy,
          replacement: async () => {
            throw new Error("boom");
          },
          concurrencyStrategy: new SemaphoreStrategy(1)
        })
      );

      transformer.start(controller);
      await transformer.transform(family.chunkOf("M"));
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
      const transformer = family.create(
        new LookaheadTransformEngine({
          searchStrategy: strategy,
          replacement,
          concurrencyStrategy: new SemaphoreStrategy(1)
        })
      );

      const source = family
        .fromBytes(byteStreamOf([new TextEncoder().encode("pre M post")]))
        .pipeThrough(new TransformStream<C, C>(transformer));

      await expect(text(source)).resolves.toBe("pre X post");
    });
  });
}

describeWebAdapter(byteWebAdapter);
describeWebAdapter(textWebAdapter);

describe("ReplaceContentTransformer + SerialTransformEngine + StringAnchorSearchStrategy (bytes)", () => {
  const splits = everyTwoWayByteSplit("a{{£€😀}}b").map((chunks, splitAt) => ({ chunks, splitAt }));

  describe.each([
    { kind: "synchronous", replacement: (match: string) => `[${match}]` },
    { kind: "asynchronous", replacement: async (match: string) => `[${match}]` }
  ])("$kind replacement", ({ replacement }) => {
    it.each(splits)(
      "replaces a match holding 2-, 3- and 4-byte characters wherever the input is split (at byte $splitAt)",
      async ({ chunks }) => {
        const replaced = byteStreamOf(chunks).pipeThrough(
          new TransformStream(
            new ReplaceContentTransformer(
              new SerialTransformEngine({
                searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
                replacement
              })
            )
          )
        );

        await expect(text(replaced)).resolves.toBe("a[{{£€😀}}]b");
      }
    );
  });

  it("can be handed straight to a Response, which needs bytes", async () => {
    const replaced = new Response("Hello {{name}}").body!.pipeThrough(
      new TransformStream(
        new ReplaceContentTransformer(
          new SerialTransformEngine({
            searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
            replacement: "world"
          })
        )
      )
    );

    await expect(new Response(replaced).text()).resolves.toBe("Hello world");
  });
});
