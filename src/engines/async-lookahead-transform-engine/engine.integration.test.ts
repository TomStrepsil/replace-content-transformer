import { describe, it, expect } from "vitest";
import { text } from "node:stream/consumers";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.js";
import { AsyncReplaceContentTransformer } from "../../adapters/web/async-transformer.js";
import { AsyncLookaheadTransformEngine } from "./engine.js";
import { nested } from "./nested.js";
import { SemaphoreStrategy } from "./concurrency-strategy/semaphore-strategy.js";
import { PriorityQueueStrategy } from "./concurrency-strategy/priority-queue-strategy.js";
import { streamOrder } from "./concurrency-strategy/node-comparators.js";
import { startTestHttpServer, deferred } from "../../../test/utilities.js";

function streamFromChunks(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

function makeTransformer<TState>(
  options: ConstructorParameters<typeof AsyncLookaheadTransformEngine<TState, string>>[0]
): AsyncReplaceContentTransformer {
  return new AsyncReplaceContentTransformer(
    new AsyncLookaheadTransformEngine(options)
  );
}

describe("AsyncLookaheadTransformEngine — end-to-end integration", () => {
  it("replaces matches found by StringAnchorSearchStrategy across chunk boundaries", async () => {
    const transformer = makeTransformer({
      searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
      replacement: async (match) =>
        (async function* () {
          yield match.slice(2, -2).toUpperCase();
        })(),
      concurrencyStrategy: new SemaphoreStrategy(4)
    });

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

    const transformer = makeTransformer({
      searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
      replacement: async (match) => {
        if (match === "{{first}}") {
          await firstGate.promise;
          return (async function* () {
            yield "FIRST";
          })();
        }
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

    await expect(secondStarted.promise).resolves.toBeUndefined();

    firstGate.resolve();
    await expect(outputPromise).resolves.toBe("FIRST and SECOND");
  });

  it("preserves output order when later matches resolve before earlier ones", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    gates.set("{{a}}", deferred());
    gates.set("{{b}}", deferred());
    gates.set("{{c}}", deferred());

    const transformer = makeTransformer({
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

    gates.get("{{c}}")!.resolve();
    gates.get("{{b}}")!.resolve();
    gates.get("{{a}}")!.resolve();

    await expect(outputPromise).resolves.toBe("A-B-C");
  });

  it("streams a real HTTP fragment body through a match (ESI-style)", async () => {
    const httpServer = await startTestHttpServer({
      "/lookahead/fragment": () => new Response("<h1>fragment body</h1>")
    });

    try {
      const fragmentUrl = `${httpServer.baseUrl}/lookahead/fragment`;
      const transformer = makeTransformer({
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
    } finally {
      await httpServer.close();
    }
  });

  it("recursively expands nested fragments via a nested() return value", async () => {
    const httpServer = await startTestHttpServer({
      "/lookahead/outer": (req) => {
        const innerUrl = new URL("/lookahead/inner", req.url).toString();
        return new Response(`<o><esi:include src="${innerUrl}" /></o>`);
      },
      "/lookahead/inner": (req) => {
        const leafUrl = new URL("/lookahead/leaf", req.url).toString();
        return new Response(`<i><esi:include src="${leafUrl}" /></i>`);
      },
      "/lookahead/leaf": () => new Response("leaf!")
    });

    try {
      const outerUrl = `${httpServer.baseUrl}/lookahead/outer`;
      const transformer = makeTransformer({
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
    } finally {
      await httpServer.close();
    }
  });

  it("emits in stream order even when a deeper nested fragment is ready first", async () => {
    const slowGate = deferred<void>();

    const httpServer = await startTestHttpServer({
      "/lookahead/slow": async (req) => {
        await slowGate.promise;
        const nestedUrl = new URL("/lookahead/nested", req.url).toString();
        return new Response(`[slow <esi:include src="${nestedUrl}" />]`);
      },
      "/lookahead/nested": () => new Response("nested"),
      "/lookahead/fast": () => new Response("[fast]")
    });

    try {
      const slowSiblingUrl = `${httpServer.baseUrl}/lookahead/slow`;
      const fastSiblingUrl = `${httpServer.baseUrl}/lookahead/fast`;

      const transformer = makeTransformer({
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

      await new Promise((r) => setTimeout(r, 10));
      slowGate.resolve();

      await expect(sourcePromise).resolves.toBe("[slow nested] + [fast]");
    } finally {
      await httpServer.close();
    }
  });
});
