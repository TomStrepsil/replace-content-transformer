import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { text } from "node:stream/consumers";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.ts";
import { LookaheadAsyncIterableTransformer } from "./lookahead-async-iterable-transformer.ts";
import { nested } from "../../lookahead/nested.ts";
import { SemaphoreStrategy } from "../../lookahead/concurrency-strategy/semaphore-strategy.ts";
import { PriorityQueueStrategy } from "../../lookahead/concurrency-strategy/priority-queue-strategy.ts";
import { streamOrder } from "../../lookahead/concurrency-strategy/node-comparators.ts";
import { server, deferred } from "../../../test/utilities.ts";

function streamFromChunks(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

describe("Lookahead transformer — end-to-end integration", () => {
  it("replaces matches found by StringAnchorSearchStrategy across chunk boundaries", async () => {
    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
      replacement: async (match) =>
        (async function* () {
          yield match.slice(2, -2).toUpperCase();
        })(),
      concurrencyStrategy: new SemaphoreStrategy(4)
    });

    // Deliberate match split across chunks to exercise the search
    // strategy's partial-match buffering.
    const out = await text(
      streamFromChunks(["pre {{foo", "}} mid {{bar}} post"]).pipeThrough(
        new TransformStream(transformer)
      )
    );

    expect(out).toBe("pre FOO mid BAR post");
  });

  it("initiates later matches eagerly while earlier ones are still resolving", async () => {
    const firstGate = deferred<void>();
    const secondStarted = deferred<void>();

    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
      replacement: async (match) => {
        if (match === "{{first}}") {
          await firstGate.promise;
          return (async function* () {
            yield "FIRST";
          })();
        }
        // The second replacement's body runs as soon as the concurrency
        // strategy dispatches it — independent of drain progress on the
        // first slot. If scheduling were serial, this would never resolve
        // while `firstGate` is still pending.
        secondStarted.resolve();
        return (async function* () {
          yield "SECOND";
        })();
      },
      concurrencyStrategy: new SemaphoreStrategy(4)
    });

    const transformed = streamFromChunks([
      "{{first}} and {{second}}"
    ]).pipeThrough(new TransformStream(transformer));
    const outputPromise = text(transformed);

    // Must resolve without any help from the first gate — proves the
    // second match's replacement fn was invoked eagerly (lookahead).
    await expect(secondStarted.promise).resolves.toBeUndefined();

    firstGate.resolve();
    await expect(outputPromise).resolves.toBe("FIRST and SECOND");
  });

  it("preserves output order when later matches resolve before earlier ones", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    gates.set("{{a}}", deferred());
    gates.set("{{b}}", deferred());
    gates.set("{{c}}", deferred());

    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
      replacement: async (match) => {
        await gates.get(match)!.promise;
        return (async function* () {
          yield match.slice(2, -2).toUpperCase();
        })();
      },
      concurrencyStrategy: new SemaphoreStrategy(4)
    });

    const transformed = streamFromChunks(["{{a}}-{{b}}-{{c}}"]).pipeThrough(
      new TransformStream(transformer)
    );
    const outputPromise = text(transformed);

    // Release in reverse order — earlier matches' output must still emit first.
    gates.get("{{c}}")!.resolve();
    gates.get("{{b}}")!.resolve();
    gates.get("{{a}}")!.resolve();

    await expect(outputPromise).resolves.toBe("A-B-C");
  });

  it("streams a real HTTP fragment body through a match (ESI-style)", async () => {
    const fragmentUrl = "https://example.com/lookahead/fragment";
    server.use(
      http.get(fragmentUrl, () =>
        HttpResponse.text("<h1>fragment body</h1>")
      )
    );

    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
      replacement: async (match) => {
        const [, url] = /src="([^"]+)"/.exec(match)!;
        const res = await fetch(url);
        return res.body!.pipeThrough(new TextDecoderStream());
      },
      concurrencyStrategy: new SemaphoreStrategy(4)
    });

    const out = await text(
      streamFromChunks([
        `<div><esi:include src="${fragmentUrl}" /></div>`
      ]).pipeThrough(new TransformStream(transformer))
    );

    expect(out).toBe("<div><h1>fragment body</h1></div>");
  });

  it("recursively expands nested fragments via a nested() return value", async () => {
    const outerUrl = "https://example.com/lookahead/outer";
    const innerUrl = "https://example.com/lookahead/inner";
    const leafUrl = "https://example.com/lookahead/leaf";

    server.use(
      http.get(outerUrl, () =>
        HttpResponse.text(`<o><esi:include src="${innerUrl}" /></o>`)
      ),
      http.get(innerUrl, () =>
        HttpResponse.text(`<i><esi:include src="${leafUrl}" /></i>`)
      ),
      http.get(leafUrl, () => HttpResponse.text("leaf!"))
    );

    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
      concurrencyStrategy: new SemaphoreStrategy(8),
      replacement: async (match) => {
        const [, url] = /src="([^"]+)"/.exec(match)!;
        const res = await fetch(url);
        const decoded = res.body!.pipeThrough(new TextDecoderStream());
        return nested(decoded);
      }
    });

    const sourceRes = await fetch(outerUrl);
    const source = sourceRes.body!.pipeThrough(new TextDecoderStream());
    const transformed = source.pipeThrough(new TransformStream(transformer));

    await expect(text(transformed)).resolves.toBe("<o><i>leaf!</i></o>");
  });

  it("emits in stream order even when a deeper nested fragment is ready first", async () => {
    // Outer has two siblings: first (slow, contains a nested fragment), then second (fast, literal).
    // Tree-aware streamOrder comparator should still honour the outer
    // ordering — sibling 0's chunks emit before sibling 1's chunks.
    const slowSiblingUrl = "https://example.com/lookahead/slow";
    const nestedUrl = "https://example.com/lookahead/nested";
    const fastSiblingUrl = "https://example.com/lookahead/fast";

    const slowGate = deferred<void>();

    server.use(
      http.get(slowSiblingUrl, async () => {
        await slowGate.promise;
        return HttpResponse.text(`[slow <esi:include src="${nestedUrl}" />]`);
      }),
      http.get(nestedUrl, () => HttpResponse.text("nested")),
      http.get(fastSiblingUrl, () => HttpResponse.text("[fast]"))
    );

    const transformer = new LookaheadAsyncIterableTransformer({
      searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
      concurrencyStrategy: new PriorityQueueStrategy(8, streamOrder),
      replacement: async (match) => {
        const [, url] = /src="([^"]+)"/.exec(match)!;
        const res = await fetch(url);
        const decoded = res.body!.pipeThrough(new TextDecoderStream());
        return nested(decoded);
      }
    });

    const sourcePromise = text(
      streamFromChunks([
        `<esi:include src="${slowSiblingUrl}" /> + <esi:include src="${fastSiblingUrl}" />`
      ]).pipeThrough(new TransformStream(transformer))
    );

    // Release the slow sibling after a tick — fast sibling will already have
    // resolved, but output order must still be slow-first.
    await new Promise((r) => setTimeout(r, 10));
    slowGate.resolve();

    await expect(sourcePromise).resolves.toBe("[slow nested] + [fast]");
  });
});
