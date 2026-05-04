import { describe, it, expect } from "vitest";
import { AsyncIterableFunctionReplacementProcessor } from "../../replacement-processors/async-iterable-function-replacement-processor.js";
import { AsyncReplaceContentTransformer } from "./async-transformer.js";
import { startTestHttpServer, streamToString } from "../../../test/utilities.js";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.js";

describe("AsyncReplaceContentTransformer + AsyncIterableFunctionReplacementProcessor + StringAnchorSearchStrategy", () => {
  it("passes through new chunks after abort set between chunks when no buffered remainder exists", async () => {
    const abortController = new AbortController();
    const replacement = (match: string) => match.toUpperCase();
    const transformer = new AsyncReplaceContentTransformer(
      new AsyncIterableFunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: async (match: string) => {
          return (async function* () {
            yield replacement(match);
          })();
        }
      }),
      abortController.signal
    );

    const stream = new TransformStream(transformer);
    const writer = stream.writable.getWriter();
    const outputPromise = streamToString(stream.readable);

    await writer.write("plain ");
    abortController.abort();
    await writer.write("text");
    await writer.close();

    await expect(outputPromise).resolves.toBe("plain text");
  });

  it("flushes buffered partial content before passthrough when abort is set between chunks", async () => {
    const abortController = new AbortController();
    const replacement = (match: string) => match.toUpperCase();
    const transformer = new AsyncReplaceContentTransformer(
      new AsyncIterableFunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: async (match: string) => {
          return (async function* () {
            yield replacement(match);
          })();
        }
      }),
      abortController.signal
    );

    const stream = new TransformStream(transformer);
    const writer = stream.writable.getWriter();
    const outputPromise = streamToString(stream.readable);

    await writer.write("{{a");
    abortController.abort();
    await writer.write("}} next");
    await writer.close();

    await expect(outputPromise).resolves.toBe("{{a}} next");
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
            new AsyncReplaceContentTransformer(
              new AsyncIterableFunctionReplacementProcessor({
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

  it("should support sharing an abort signal with a fetch request", async () => {
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

      const transformer = new AsyncReplaceContentTransformer(
        new AsyncIterableFunctionReplacementProcessor({
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
          }
        }),
        abortController.signal
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

  it("flushes the unprocessed remainder of a chunk when abort is signaled mid-transform", async () => {
    const abortController = new AbortController();
    const transformer = new AsyncReplaceContentTransformer(
      new AsyncIterableFunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["{{x}}"]),
        replacement: async () => {
          abortController.abort();
          return (async function* () {
            yield "REPLACED";
          })();
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

    await expect(streamToString(transformed)).resolves.toBe("REPLACED-tail next");
  });

  it("stops discovering additional matches in the current chunk after mid-transform abort", async () => {
    const abortController = new AbortController();
    const replacement = vi
      .fn()
      .mockImplementation((match: string) => match.toUpperCase());

    const transformer = new AsyncReplaceContentTransformer(
      new AsyncIterableFunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: async (match: string) => {
          abortController.abort();
          return (async function* () {
            yield replacement(match);
          })();
        }
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

    await expect(streamToString(transformed)).resolves.toBe("{{A}}{{b}}{{c}} next");
    expect(replacement).toHaveBeenCalledTimes(1);
  });
});
