import { describe, it, expect } from "vitest";
import { AsyncIterableFunctionReplacementProcessor } from "../../replacement-processors/async-iterable-function-replacement-processor";
import { AsyncReplaceContentTransformer } from "./async-transformer";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/utilities";
import { text } from "node:stream/consumers";
import { StringAnchorSearchStrategy } from "../../search-strategies/index";

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
    const outputPromise = text(stream.readable);

    await writer.write("{{a");
    abortController.abort();
    await writer.write("}} next");
    await writer.close();

    await expect(outputPromise).resolves.toBe("{{a}} next");
  });

  it("should support streaming ReadableStream into the output", async () => {
    const fragmentUrl = "https://example.com/fragment";
    server.use(
      http.get(fragmentUrl, () => {
        return HttpResponse.text("<h1>some fragment</h1>");
      })
    );
    const parentUrl = "https://example.com/parent";
    server.use(
      http.get(parentUrl, () => {
        return HttpResponse.text(
          `<div><esi:include src="${fragmentUrl}" /></div>`
        );
      })
    );

    const fetchAndDecode = async (url: string) => {
      const res = await fetch(url);
      return res.body!.pipeThrough(new TextDecoderStream());
    };

    const parentResponse = await fetchAndDecode(parentUrl);

    const result = await text(
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
  });

  it("should support sharing an abort signal with a fetch request", async () => {
    const abortController = new AbortController();

    const fragmentUrl = "https://example.com/fragment-abort";
    server.use(
      http.get(fragmentUrl, () => {
        return new Promise(() => {
          abortController.abort(); // simulate external abort during fetch
        });
      })
    );
    const parentUrl = "https://example.com/parent-abort";
    server.use(
      http.get(parentUrl, () => {
        return HttpResponse.text(
          `<esi:include src="${fragmentUrl}" /><div><esi:include src="https://example.com/some-not-attempted-fragment" /></div>`
        );
      })
    );

    const fetchAndDecode = async (url: string, signal: AbortSignal) => {
      const res = await fetch(url, { signal });
      return res.body!.pipeThrough(new TextDecoderStream());
    };

    const parentResponse = await fetch(parentUrl);
    const parentStream = parentResponse.body!.pipeThrough(
      new TextDecoderStream()
    );

    const transformer = new AsyncReplaceContentTransformer(
      new AsyncIterableFunctionReplacementProcessor({
        searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
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

    await expect(text(transformedStream)).resolves.toEqual(
      `<div>Operation Cancelled</div><div><esi:include src="https://example.com/some-not-attempted-fragment" /></div>`
    );
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

    await expect(text(transformed)).resolves.toBe("REPLACED-tail next");
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

    await expect(text(transformed)).resolves.toBe("{{A}}{{b}}{{c}} next");
    expect(replacement).toHaveBeenCalledTimes(1);
  });
});
