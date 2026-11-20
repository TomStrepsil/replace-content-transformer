import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { Readable, addAbortSignal } from "node:stream";
import { createServer, get, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { finished } from "node:stream/promises";
import { buffer, text } from "node:stream/consumers";
import { setImmediate } from "node:timers/promises";
import { ReplaceContentTransform } from "./transform.js";
import {
  asyncIterable,
  byteReplacementEngines,
  collectWritable,
  reusingOneBuffer,
  stalledStreamReplacementEngines,
  textOfPieces,
  unhandledRejectionsDuring,
  utf8,
  type ByteReplacement
} from "../../../test/utilities.js";
import { everyTwoWayByteSplit, midCharacterSplits } from "../../../test/web-adapters.js";
import { everyTwoWaySplit } from "../../../test/splits.js";
import {
  LookaheadTransformEngine,
  SemaphoreStrategy,
  SerialTransformEngine,
  nested,
  type Utf8Bytes
} from "../../engines/index.js";
import {
  RegexSearchStrategy,
  StringAnchorSearchStrategy
} from "../../search-strategies/index.js";

function sourceOf(...chunks: (string | Buffer)[]): Readable {
  return Readable.from(chunks, { objectMode: true });
}

describe("ReplaceContentTransform + SerialTransformEngine + StringAnchorSearchStrategy", () => {
  it("produces the same output whether or not a Buffer chunk boundary splits a multi-byte character", async () => {
    const bytes = Buffer.from("héllo {{x}} wörld");
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: "X"
      })
    );

    const out = await text(
      Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]).pipe(transform)
    );
    expect(out).toBe("héllo X wörld");
  });

  it.each(everyTwoWayByteSplit("\uFEFF{{name}}").map((chunks, splitAt) => ({ chunks, splitAt })))(
    "searches the text after a leading byte order mark, with the indices a TextDecoder gives, and keeps the mark at the start of the output, wherever the input is split (at byte $splitAt)",
    async ({ chunks }) => {
      const transform = new ReplaceContentTransform(
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement: (_match, { streamIndices }) => JSON.stringify(streamIndices)
        })
      );

      const out = await buffer(Readable.from(chunks).pipe(transform));
      expect(out).toEqual(Buffer.from("\uFEFF[0,8]"));
    }
  );

  it("does not call the replacement again once a data listener aborts the stopReplacingSignal on output from the same chunk", async () => {
    const abortController = new AbortController();
    const replacement = vi.fn((match: string) => match.toUpperCase());
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement,
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunks.join("").includes("{{A}}")) abortController.abort();
    });
    transform.write("x");

    transform.end("{{a}}y{{b}}z");
    await finished(transform);

    expect(chunks.join("")).toBe("x{{A}}y{{b}}z");
    expect(replacement).toHaveBeenCalledOnce();
  });

  it("lets a guard callback see that a data listener aborted the stopReplacingSignal on text reported before it", async () => {
    const abortController = new AbortController();
    const signalAbortedAtGuard: boolean[] = [];
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"], {
          maxBufferLength: 6,
          onGuardExceeded: () => {
            signalAbortedAtGuard.push(abortController.signal.aborted);
          }
        }),
        replacement: (match: string) => match.toUpperCase(),
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunks.join("").includes("x")) abortController.abort();
    });
    transform.write("w");

    transform.end("x{{123456");
    await finished(transform);

    expect(signalAbortedAtGuard).toEqual([true]);
  });

  it("stops the search straight after a replacement a data listener aborts the stopReplacingSignal on, before the strategy reaches a guard that throws", async () => {
    const abortController = new AbortController();
    const onGuardExceeded = vi.fn(() => {
      throw new Error("guard");
    });
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"], {
          maxBufferLength: 6,
          onGuardExceeded
        }),
        replacement: (match: string) => match.toUpperCase(),
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunks.join("").includes("{{A}}")) abortController.abort();
    });
    transform.write("x");

    transform.end("{{a}}{{123456");
    await finished(transform);

    expect(chunks.join("")).toBe("x{{A}}{{123456");
    expect(onGuardExceeded).not.toHaveBeenCalled();
  });

  it("lets an iterable replacement see a data listener abort the stopReplacingSignal on one of its pieces before it yields the next", async () => {
    const abortController = new AbortController();
    const replacement = vi.fn(function* (match: string) {
      yield "<";
      yield abortController.signal.aborted ? match : match.toUpperCase();
      yield ">";
    });
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement,
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunks.join("").endsWith("<")) abortController.abort();
    });
    transform.write("x");

    transform.end("{{a}}y{{b}}z");
    await finished(transform);

    expect(chunks.join("")).toBe("x<{{a}}>y{{b}}z");
    expect(replacement).toHaveBeenCalledOnce();
  });

  describe("with a stopReplacingSignal", () => {
    const transformWithSignal = () => {
      const transform = new ReplaceContentTransform(
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement: (match: string) => match.toUpperCase(),
          stopReplacingSignal: new AbortController().signal
        })
      );
      const push = vi.spyOn(transform, "push");
      const pushed = () =>
        push.mock.calls.map(([chunk]) => chunk).filter((chunk) => chunk !== null);
      return { transform, pushed };
    };

    it("stops the next replacement in the same chunk once a replacement makes the stream flow and its data listener aborts the signal", async () => {
      const abortController = new AbortController();
      const chunks: string[] = [];
      let transform: ReplaceContentTransform;
      const replacement = vi.fn((match: string) => {
        if (replacement.mock.calls.length === 1) {
          transform.on("data", (chunk: Buffer) => {
            chunks.push(chunk.toString());
            if (chunks.join("").includes("{{A}}")) abortController.abort();
          });
          transform.resume();
        }
        return match.toUpperCase();
      });
      transform = new ReplaceContentTransform(
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: abortController.signal
        })
      );
      transform.write("warm");
      await setImmediate();
      transform.read();

      transform.end("{{a}}{{b}}");
      await finished(transform);

      expect(chunks.join("")).toBe("{{A}}{{b}}");
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("stops the next replacement once a data listener attached after an earlier write with a match aborts the signal", async () => {
      const abortController = new AbortController();
      const replacement = vi.fn((match: string) => match.toUpperCase());
      const transform = new ReplaceContentTransform(
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: abortController.signal
        })
      );
      transform.write("{{x}} ");
      const chunks: string[] = [];
      transform.on("data", (chunk: Buffer) => {
        chunks.push(chunk.toString());
        if (chunks.join("").includes("{{A}}")) abortController.abort();
      });
      await setImmediate();

      transform.end("{{a}}y{{b}}z");
      await finished(transform);

      expect(chunks.join("")).toBe("{{X}} {{A}}y{{b}}z");
      expect(replacement).toHaveBeenCalledTimes(2);
    });

    it("pushes the output so far before each replacement, and each replacement as it is made, while piped to a Writable, which can react inside push()", async () => {
      const { transform, pushed } = transformWithSignal();
      const { writable } = collectWritable();
      transform.pipe(writable);

      transform.end("x{{a}}y{{b}}z");
      await finished(writable);

      expect(pushed()).toEqual(["x", "{{A}}", "y", "{{B}}", "z"]);
    });
  });
});

describe("ReplaceContentTransform + SerialTransformEngine + RegexSearchStrategy", () => {
  it("keeps an astral character intact in the output when a nullable pattern skips a zero-length match in front of it", async () => {
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new RegexSearchStrategy(/a*/),
        replacement: "Z"
      })
    );

    const out = await text(Readable.from(["x😀ya"]).pipe(transform));
    expect(out).toBe("x😀yZ");
  });

  it("keeps an astral character intact in the output when a match ends between the two halves of its surrogate pair", async () => {
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new RegexSearchStrategy(/a./),
        replacement: (match) => match[0]
      })
    );

    const out = await text(Readable.from(["a😀b"]).pipe(transform));
    expect(out).toBe("a😀b");
  });
});

describe("ReplaceContentTransform + SerialTransformEngine with asynchronous replacements + StringAnchorSearchStrategy", () => {
  it("replaces matches in order when some replacements are synchronous and some asynchronous", async () => {
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: (match, { matchIndex }) =>
          matchIndex % 2 ? Promise.resolve(match.toUpperCase()) : match
      })
    );

    const output = await text(sourceOf("a{{b}}c{{d}}", "e{{f}}g{{", "h}}i").pipe(transform));

    expect(output).toBe("a{{b}}c{{D}}e{{f}}g{{H}}i");
  });

  it("calls no further replacement once a data listener destroys the stream on receiving an awaited replacement", async () => {
    const replacement = vi.fn(async (match: string) => match.toUpperCase());
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement
      })
    );
    const received: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      received.push(chunk.toString());
      if (received.length === 2) transform.destroy();
    });

    transform.write("x{{a}}y{{b}}z");
    await new Promise((resolve) => transform.on("close", resolve));

    expect(received).toEqual(["x", "{{A}}"]);
    expect(replacement).toHaveBeenCalledOnce();
  });

  it("cancels a ReadableStream replacement it has called but not read once a data listener destroys the stream", async () => {
    const cancel = vi.fn();
    const transform = new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: (_match, { matchIndex }) =>
          matchIndex === 0
            ? Promise.resolve("Y")
            : new ReadableStream<string>({ pull: (controller) => controller.enqueue("Z"), cancel })
      })
    );
    transform.on("data", (chunk: Buffer) => {
      if (chunk.toString() === "b") transform.destroy();
    });

    transform.write("a{{x}}b{{y}}c");
    await new Promise((resolve) => transform.on("close", resolve));
    await setImmediate();

    expect(cancel).toHaveBeenCalledOnce();
  });
});

// Engine behaviour (scan/schedule/drain, nested re-scanning, backpressure,
// error forwarding, in-order output) is verified directly in
// `src/engines/lookahead-transform-engine/engine.test.ts`. These tests
// cover only the Node-adapter specifics: Buffer decoding, `'error'` event
// emission via destroy(), cancelling the engine on destroy(), and
// `highWaterMark` forwarding onto the underlying stream.Transform.

describe("ReplaceContentTransform + LookaheadTransformEngine (Node adapter) + StringAnchorSearchStrategy", () => {
  it("decodes incoming Buffer chunks as UTF-8", async () => {
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
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

  it("produces the same output whether or not a Buffer chunk boundary splits a multi-byte character", async () => {
    const bytes = Buffer.from("héllo {{x}} wörld");
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: async () =>
          (async function* () {
            yield "X";
          })(),
        concurrencyStrategy: new SemaphoreStrategy(2)
      })
    );

    const out = await text(
      sourceOf(bytes.subarray(0, 2), bytes.subarray(2)).pipe(transform)
    );
    expect(out).toBe("héllo X wörld");
  });

  it("keeps an astral character intact in the output when a match ends between the two halves of its surrogate pair", async () => {
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["\uDE00"]),
        replacement: async (match) =>
          (async function* () {
            yield match;
          })(),
        concurrencyStrategy: new SemaphoreStrategy(2)
      })
    );

    const out = await text(sourceOf("😀").pipe(transform));
    expect(out).toBe("😀");
  });

  it("surfaces engine errors as a stream 'error' event via destroy()", async () => {
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
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

  it("closes scheduled replacements early once the stream is destroyed", async () => {
    const released = Promise.withResolvers<void>();
    const started: string[] = [];
    const completed: string[] = [];
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(8),
        replacement: async (match) => {
          started.push(match);
          await released.promise;
          return (async function* () {
            yield match.toUpperCase();
            yield match.toUpperCase();
            completed.push(match);
          })();
        }
      })
    );

    transform.resume();
    transform.write("{{a}} {{b}} {{c}}");
    await vi.waitFor(() => expect(started).toEqual(["{{a}}", "{{b}}", "{{c}}"]));
    transform.destroy();
    released.resolve();
    await setImmediate();

    expect(completed).toEqual([]);
  });

  it("forwards highWaterMark via TransformOptions", () => {
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
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

  it("recursively re-scans nested() content fed through a Node Readable", async () => {
    const fragments: Record<string, string> = {
      outer: "<o>{{inner}}</o>",
      inner: "<i>{{leaf}}</i>",
      leaf: "leaf!"
    };

    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match, { depth }) => {
          const key = match.slice(2, -2);
          const content = fragments[key] ?? "";
          const source = Readable.from([content]);
          return depth < 2 ? nested(source) : source;
        }
      })
    );

    const out = await text(sourceOf("{{outer}}").pipe(transform));
    expect(out).toBe("<o><i>leaf!</i></o>");
  });
});

describe.each(byteReplacementEngines)("ReplaceContentTransform + $engine, with replacements that return bytes", ({ create }) => {
  const replaced = (input: string, replacement: ByteReplacement) =>
    text(sourceOf(input).pipe(new ReplaceContentTransform(create(replacement))));

  it.each(midCharacterSplits())(
    "replaces a match with a fragment's bytes, wherever its chunks split a 2-, 3- or 4-byte character (at byte $splitAt)",
    async ({ chunks }) => {
      await expect(replaced("a{{x}}b", async () => asyncIterable(...chunks))).resolves.toBe("a£€😀b");
    }
  );

  it.each([
    {
      bytes: "a character a fragment leaves incomplete, rather than completing it with the next fragment's bytes",
      input: "a{{x}}{{y}}b",
      output: "a\uFFFD\uFFFDb"
    },
    { bytes: "malformed bytes in a fragment", input: "a{{z}}b", output: "a<\uFFFD>b" }
  ])("pushes $bytes as U+FFFD", async ({ input, output }) => {
    const fragments: Record<string, Utf8Bytes> = {
      "{{x}}": Uint8Array.of(0xe2, 0x82),
      "{{y}}": Uint8Array.of(0xac),
      "{{z}}": Uint8Array.of(0x3c, 0xff, 0x3e)
    };
    const transform = new ReplaceContentTransform(create(async (match) => asyncIterable(fragments[match])));

    expect(textOfPieces(await sourceOf(input).pipe(transform).toArray())).toBe(output);
  });

  it("pushes each piece of a fragment that reuses its buffer for the next piece as it was", async () => {
    await expect(
      replaced("a{{x}}b", async () => reusingOneBuffer("1", "2"))
    ).resolves.toBe("a12b");
  });

  it("aborts the replacement's signal when the stream is destroyed, so a Readable given it stops straight away, where the engine could close it only at its next chunk", async () => {
    let readable!: Readable;
    const transform = new ReplaceContentTransform(
      create(async (_match, { signal }) => {
        readable = unfinishedReadableGiven(signal, "first");
        return readable;
      })
    );
    sourceOf("a{{x}}b").pipe(transform);
    let received = "";
    for await (const chunk of transform) {
      received += String(chunk);
      if (received.includes("first")) break;
    }

    await vi.waitFor(() => expect(readable.destroyed).toBe(true));
  });

  it("pushes only strings when readableObjectMode is set, decoding a replacement's bytes", async () => {
    const transform = new ReplaceContentTransform(
      create(async () => asyncIterable(utf8("£€"))),
      { readableObjectMode: true }
    );

    const chunks = await sourceOf("a{{x}}b").pipe(transform).toArray();

    expect(chunks.every((chunk) => typeof chunk === "string")).toBe(true);
    expect(chunks.join("")).toBe("a£€b");
  });

  it("streams a Node Readable of Buffers into the output, with no setEncoding", async () => {
    await expect(
      replaced("a{{x}}b", async () => Readable.from([Buffer.from("£€"), Buffer.from("😀")]))
    ).resolves.toBe("a£€😀b");
  });

  describe.each(["latin1", "utf16le"] as const)("with defaultEncoding %s", (defaultEncoding) => {
    it.each(everyTwoWayByteSplit("\uFEFFé {{x}} €").map((chunks, splitAt) => ({ chunks, splitAt })))(
      "emits UTF-8 text, a leading byte order mark included, around a replacement's bytes, since defaultEncoding describes strings written to the stream, not what it emits, wherever the input is split (at byte $splitAt)",
      async ({ chunks }) => {
        const transform = new ReplaceContentTransform(create(async () => asyncIterable(utf8("£"))), {
          defaultEncoding
        });

        const out = await buffer(Readable.from(chunks).pipe(transform));
        expect(out).toEqual(Buffer.from("\uFEFFé £ €"));
      }
    );
  });
});

describe("ReplaceContentTransform + LookaheadTransformEngine, with nested() replacements that return bytes", () => {
  it("re-scans the Buffers of a nested() Node Readable at a depth over 1", async () => {
    const fragments: Record<string, string> = {
      "{{outer}}": "<o>€{{inner}}</o>",
      "{{inner}}": "<i>😀{{leaf}}</i>",
      "{{leaf}}": "leaf£"
    };
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match, { depth }) => {
          const encoded = Buffer.from(fragments[match]);
          const source = Readable.from([encoded.subarray(0, 4), encoded.subarray(4)]);
          return depth < 2 ? nested(source) : source;
        }
      })
    );

    await expect(text(sourceOf("{{outer}}").pipe(transform))).resolves.toBe("<o>€<i>😀leaf£</i></o>");
  });

  it("pushes each piece of a replacement within nested() content that reuses its buffer for the next piece as it was", async () => {
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) =>
          match === "{{outer}}" ? nested(asyncIterable("<{{leaf}}>")) : reusingOneBuffer("1", "2")
      })
    );

    await expect(text(sourceOf("{{outer}}").pipe(transform))).resolves.toBe("<12>");
  });
});

describe("ReplaceContentTransform + LookaheadTransformEngine, failing replacement", () => {
  it("destroys the stream with the replacement's error, leaving no rejection unhandled", async () => {
    let streamError: unknown;
    const unhandled = await unhandledRejectionsDuring(async () => {
      const transform = new ReplaceContentTransform(
        new LookaheadTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          concurrencyStrategy: new SemaphoreStrategy(4),
          replacement: async () => {
            throw new Error("fragment failed");
          }
        })
      );
      streamError = await text(sourceOf("a{{x}}b").pipe(transform)).catch((error: unknown) => error);
    });

    expect(streamError).toEqual(new Error("fragment failed"));
    expect(unhandled).toEqual([]);
  });
});

const unfinishedReadableGiven = (signal: AbortSignal, produced: string) => {
  const readable = new Readable({ read() {} });
  readable.push(produced);
  return addAbortSignal(signal, readable);
};

function abortingOnOutput(transform: ReplaceContentTransform, abortController: AbortController, seen: string): string[] {
  const chunks: string[] = [];
  transform.on("data", (chunk: Buffer) => {
    chunks.push(chunk.toString());
    if (chunks.join("").endsWith(seen)) abortController.abort();
  });
  return chunks;
}

const nodeHttpRejectsAbortedRequestWithoutCause = typeof Deno !== "undefined";

describe("ReplaceContentTransform + SerialTransformEngine, with a replacement that fails with an AbortError whose cause is the stopReplacingSignal's reason", () => {
  const transformReplacingWith = (abortController: AbortController, replacement: () => Promise<Readable>) =>
    new ReplaceContentTransform(
      new SerialTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement,
        stopReplacingSignal: abortController.signal
      })
    );

  it("ends a Readable given the signal through addAbortSignal after what it produced", async () => {
    const abortController = new AbortController();
    const transform = transformReplacingWith(abortController, async () =>
      unfinishedReadableGiven(abortController.signal, "first")
    );
    const chunks = abortingOnOutput(transform, abortController, "first");

    transform.end("a{{x}}b");
    await finished(transform);

    expect(chunks.join("")).toBe("afirstb");
  });

  describe("from an http.get request given the signal", () => {
    let server: Server;
    let baseUrl: string;
    let onRequest: () => void = () => {};
    beforeEach(async () => {
      server = createServer((request, response) => {
        if (request.url === "/unanswered") onRequest();
        else response.write("first");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(() => {
      server.closeAllConnections();
      server.close();
    });
    const requestGiven = (signal: AbortSignal, path: string, responseOf = (response: IncomingMessage): Readable => response) =>
      new Promise<Readable>((resolve, reject) =>
        get(`${baseUrl}${path}`, { signal }, (response) => resolve(responseOf(response))).on("error", reject)
      );

    it.skipIf(nodeHttpRejectsAbortedRequestWithoutCause)(
      "emits the match verbatim when the signal aborts before the response arrives (not on Deno, whose node:http rejects without the cause)",
      async () => {
        const abortController = new AbortController();
        onRequest = () => abortController.abort();
        const transform = transformReplacingWith(abortController, () =>
          requestGiven(abortController.signal, "/unanswered")
        );

        await expect(text(sourceOf("a{{x}}b").pipe(transform))).resolves.toBe("a{{x}}b");
      }
    );

    it("ends its response part way through when the response is given the signal through addAbortSignal", async () => {
      const abortController = new AbortController();
      const transform = transformReplacingWith(abortController, () =>
        requestGiven(abortController.signal, "/body", (response) => addAbortSignal(abortController.signal, response))
      );
      const chunks = abortingOnOutput(transform, abortController, "first");

      transform.end("a{{x}}b");
      await finished(transform);

      expect(chunks.join("")).toBe("afirstb");
    });
  });
});

describe("ReplaceContentTransform + LookaheadTransformEngine, with a nested() Readable given the stopReplacingSignal through addAbortSignal", () => {
  it("ends the source after what it produced, and the child engine emits the output of its replacements", async () => {
    const abortController = new AbortController();
    const transform = new ReplaceContentTransform(
      new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) =>
          match === "{{y}}"
            ? asyncIterable("INNER")
            : nested(unfinishedReadableGiven(abortController.signal, "first {{y}} {")),
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks = abortingOnOutput(transform, abortController, "INNER");

    transform.end("a{{x}}b");
    await finished(transform);

    expect(chunks.join("")).toBe("afirst INNER {b");
  });
});

describe("ReplaceContentTransform, with ReadableStream replacements that never yield, once the stream is destroyed", () => {
  const splits = everyTwoWaySplit("a{{x}}b{{y}}c").map((chunks) => ({ chunks }));

  describe.each(stalledStreamReplacementEngines)("$engine", ({ called, create }) => {
    it.each(splits)("cancels each one it has called, whether or not it was being read, for $chunks", async ({ chunks }) => {
      const cancelled: string[] = [];
      const lastCall = Promise.withResolvers<void>();
      const transform = new ReplaceContentTransform(
        create(cancelled, (match) => {
          if (match === called.at(-1)) lastCall.resolve();
        })
      );
      transform.resume();
      for (const chunk of chunks) transform.write(chunk);
      await lastCall.promise;
      await setImmediate();

      transform.destroy();
      await setImmediate();

      expect(cancelled.toSorted()).toEqual(called);
    });
  });
});
