import { describe, it, expect } from "vitest";
import { AsyncIterableFunctionReplacementProcessor } from "../../replacement-processors/async-iterable-function-replacement-processor.ts";
import { AsyncReplaceContentTransformer } from "./async-transformer.ts";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/utilities.ts";
import { text } from "node:stream/consumers";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.ts";

describe("AsyncReplaceContentTransformer + AsyncIterableFunctionReplacementProcessor + StringAnchorSearchStrategy", () => {
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

    const resultPromise = text(transformedStream);

    await expect(resultPromise).resolves.toEqual(
      `<div>Operation Cancelled</div><div><esi:include src="https://example.com/some-not-attempted-fragment" /></div>`
    );
  });
});
