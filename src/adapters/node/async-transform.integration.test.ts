import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { AsyncReplaceContentTransform } from "./async-transform.js";
import { AsyncLookaheadTransformEngine } from "../../engines/async-lookahead-transform-engine/engine.js";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.js";
import { SemaphoreStrategy } from "../../engines/async-lookahead-transform-engine/concurrency-strategy/semaphore-strategy.js";

// Engine behaviour (scan/schedule/drain, nested re-scanning, backpressure,
// error forwarding, in-order output) is verified directly in
// `src/lookahead/engine.test.ts`. These tests cover only the Node-adapter
// specifics: Buffer decoding, `'error'` event emission via destroy(), and
// `highWaterMark` forwarding onto the underlying stream.Transform.

function sourceOf(...chunks: (string | Buffer)[]): Readable {
  return Readable.from(chunks, { objectMode: true });
}

describe("AsyncReplaceContentTransform + LookaheadTransformEngine (Node adapter)", () => {
  it("decodes incoming Buffer chunks as UTF-8", async () => {
    const transform = new AsyncReplaceContentTransform(
      new AsyncLookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: async (match) =>
          (async function* () {
            yield match.slice(2, -2).toUpperCase();
          })(),
        concurrencyStrategy: new SemaphoreStrategy(2)
      })
    );

    const out = await text(
      sourceOf(
        Buffer.from("pre {{foo}}", "utf8"),
        Buffer.from(" end", "utf8")
      ).pipe(transform)
    );
    expect(out).toBe("pre FOO end");
  });

  it("surfaces engine errors as a stream 'error' event via destroy()", async () => {
    const transform = new AsyncReplaceContentTransform(
      new AsyncLookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(1),
        replacement: async () => {
          throw new Error("boom");
        }
      })
    );

    const errored = new Promise<Error>((resolve) =>
      transform.on("error", resolve)
    );
    sourceOf("a {{m}} b").pipe(transform);
    transform.on("data", () => {});

    const err = await errored;
    expect(err.message).toBe("boom");
  });

  it("forwards highWaterMark via TransformOptions", () => {
    const transform = new AsyncReplaceContentTransform(
      new AsyncLookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(1),
        replacement: async () =>
          (async function* () {
            yield "";
          })()
      }),
      { highWaterMark: 7 }
    );
    expect(transform.writableHighWaterMark).toBe(7);
    expect(transform.readableHighWaterMark).toBe(7);
  });
});
