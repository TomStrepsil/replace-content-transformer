import { describe, it, expect, vi } from "vitest";
import { text } from "node:stream/consumers";
import { setImmediate } from "node:timers/promises";
import { ReplaceContentTransformer } from "./transformer.js";
import { SerialTransformEngine } from "../../engines/serial-transform-engine.js";
import { LookaheadTransformEngine, SemaphoreStrategy } from "../../engines/index.js";
import { StringAnchorSearchStrategy } from "../../search-strategies/index.js";
import { nested } from "../../engines/lookahead-transform-engine/nested.js";
import type { TransformEngine, Utf8Bytes } from "../../engines/types.js";
import {
  asyncIterable,
  byteReplacementEngines,
  mockSearchStrategyFactory,
  mockTransformStreamDefaultControllerFactory,
  reusingOneBuffer,
  stalledStreamReplacementEngines,
  startTestHttpServer,
  textOfPieces,
  unhandledRejectionsDuring,
  utf8,
  type ByteReplacement
} from "../../../test/utilities.js";
import {
  byteStreamOf,
  byteWebAdapter,
  everyTwoWayByteSplit,
  midCharacterSplits,
  textWebAdapter,
  type Bytes,
  type WebAdapterFamily,
  type WebChunk
} from "../../../test/web-adapters.js";
import { everySplitOf, everyTwoWaySplit } from "../../../test/splits.js";

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

      const transformed = family
        .fromBytes(
          byteStreamOf([utf8("{{a}}{{b}}{{c}}"), utf8(" next")])
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
        .fromBytes(byteStreamOf([utf8("pre M post")]))
        .pipeThrough(new TransformStream<C, C>(transformer));

      await expect(text(source)).resolves.toBe("pre X post");
    });
  });
}

function describeByteReplacements<C extends WebChunk>(family: WebAdapterFamily<C>) {
  const outputOf = (input: string | ReadableStream<Uint8Array<ArrayBuffer>>, engine: TransformEngine) =>
    family
      .fromBytes(typeof input === "string" ? byteStreamOf([utf8(input)]) : input)
      .pipeThrough(new TransformStream<C, C>(family.create(engine)));

  describe.each(byteReplacementEngines)(`${family.adapter} + $engine, with replacements that return bytes`, ({ create }) => {
    const replaced = (input: string, replacement: ByteReplacement) => text(outputOf(input, create(replacement)));

    it.each(midCharacterSplits())(
      "replaces a match with a fragment's bytes, wherever its chunks split a 2-, 3- or 4-byte character (at byte $splitAt)",
      async ({ chunks }) => {
        await expect(replaced("a{{x}}b", async () => byteStreamOf(chunks))).resolves.toBe("a£€😀b");
      }
    );

    const piecesOf = async (input: string, replacement: ByteReplacement) =>
      textOfPieces(await Array.fromAsync<string | Utf8Bytes>(outputOf(input, create(replacement))));

    it.each([
      {
        bytes: "a character a fragment leaves incomplete, rather than completing it with the next fragment's bytes",
        input: "a{{x}}{{y}}b",
        output: "a\uFFFD\uFFFDb"
      },
      { bytes: "malformed bytes in a fragment", input: "a{{z}}b", output: "a<\uFFFD>b" }
    ])("emits $bytes as U+FFFD", async ({ input, output }) => {
      const fragments: Record<string, Utf8Bytes> = {
        "{{x}}": Uint8Array.of(0xe2, 0x82),
        "{{y}}": Uint8Array.of(0xac),
        "{{z}}": Uint8Array.of(0x3c, 0xff, 0x3e)
      };

      await expect(piecesOf(input, async (match) => asyncIterable(fragments[match]))).resolves.toBe(output);
    });

    it("emits each piece of a fragment that reuses its buffer for the next piece as it was", async () => {
      await expect(
        replaced("a{{x}}b", async () => reusingOneBuffer("1", "2"))
      ).resolves.toBe("a12b");
    });

    it("mixes string and byte pieces of one replacement in order", async () => {
      await expect(
        replaced("a{{x}}b", async () => asyncIterable<string | Utf8Bytes>("x", utf8("€"), "y"))
      ).resolves.toBe("ax€yb");
    });

    it.each([
      { body: "a fetch response body", fragment: utf8("<h1>fragment €</h1>") },
      { body: "a fetch response body that starts with a byte order mark", fragment: utf8("\uFEFF<h1>fragment €</h1>") }
    ])("streams $body into the output, with no TextDecoderStream", async ({ fragment }) => {
      const httpServer = await startTestHttpServer({ "/fragment": () => new Response(fragment) });
      try {
        await expect(
          replaced("<div>{{x}}</div>", async () => (await fetch(`${httpServer.baseUrl}/fragment`)).body!)
        ).resolves.toBe("<div><h1>fragment €</h1></div>");
      } finally {
        await httpServer.close();
      }
    });
  });

  describe(`${family.adapter} + LookaheadTransformEngine, with nested() replacements that return bytes`, () => {
    it("re-scans nested() byte content at a depth over 1", async () => {
      const fragments: Record<string, string> = {
        "{{outer}}": "<o>€{{inner}}</o>",
        "{{inner}}": "<i>😀{{leaf}}</i>",
        "{{leaf}}": "leaf£"
      };
      const engine = new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match, { depth }) => {
          const fragment = new Response(fragments[match]).body!;
          return depth < 2 ? nested(fragment) : fragment;
        }
      });

      await expect(text(outputOf("{{outer}}", engine))).resolves.toBe("<o>€<i>😀leaf£</i></o>");
    });

    it("emits each piece of a replacement within nested() content that reuses its buffer for the next piece as it was", async () => {
      const engine = new LookaheadTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        concurrencyStrategy: new SemaphoreStrategy(4),
        replacement: async (match) =>
          match === "{{outer}}" ? nested(asyncIterable("<{{leaf}}>")) : reusingOneBuffer("1", "2")
      });

      await expect(text(outputOf("{{outer}}", engine))).resolves.toBe("<12>");
    });
  });

  describe(`${family.adapter} + LookaheadTransformEngine, failing replacement`, () => {
    it("errors the stream with the replacement's error, leaving no rejection unhandled", async () => {
      let streamError: unknown;
      const unhandled = await unhandledRejectionsDuring(async () => {
        const engine = new LookaheadTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          concurrencyStrategy: new SemaphoreStrategy(4),
          replacement: async () => {
            throw new Error("fragment failed");
          }
        });
        streamError = await text(outputOf("a{{x}}b", engine)).catch((error: unknown) => error);
      });

      expect(streamError).toEqual(new Error("fragment failed"));
      expect(unhandled).toEqual([]);
    });
  });

  describe.each([
    {
      engine: "SerialTransformEngine",
      engineFor: (replacement: () => Promise<ReadableStream<Utf8Bytes>>, signal: AbortSignal): TransformEngine =>
        new SerialTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: signal
        })
    },
    {
      engine: "LookaheadTransformEngine",
      engineFor: (replacement: () => Promise<ReadableStream<Utf8Bytes>>, signal: AbortSignal): TransformEngine =>
        new LookaheadTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          concurrencyStrategy: new SemaphoreStrategy(4),
          replacement,
          stopReplacingSignal: signal
        })
    }
  ])(`${family.adapter} + $engine, with a replacement body that fails with the stopReplacingSignal's reason`, ({ engineFor }) => {
    const bodyAbortingOnceRead = (abortController: AbortController) =>
      new ReadableStream<Utf8Bytes>({
        start(controller) {
          controller.enqueue(utf8("first"));
        },
        pull(controller) {
          abortController.abort();
          controller.error(abortController.signal.reason);
        }
      });

    it.each(everySplitOf("a{{x}}b").map((chunks) => ({ chunks })))(
      "ends the body after what it produced and passes the rest of the input through, split as $chunks",
      async ({ chunks }) => {
        const abortController = new AbortController();
        const engine = engineFor(async () => bodyAbortingOnceRead(abortController), abortController.signal);

        const transformed = family
          .fromBytes(byteStreamOf(chunks.map(utf8)))
          .pipeThrough(new TransformStream<C, C>(family.create(engine)));

        await expect(text(transformed)).resolves.toBe("afirstb");
      }
    );
  });

  describe(`${family.adapter} + LookaheadTransformEngine, with a replacement that rejects with the stopReplacingSignal's reason`, () => {
    it.each(Array.from({ length: 8 }, (_, hops) => ({ hops })))(
      "enqueues nothing and leaves nothing unhandled when the stream is cancelled $hops microtasks after the abort",
      async ({ hops }) => {
        const abortController = new AbortController();
        const transformer = family.create(
          new LookaheadTransformEngine({
            searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
            concurrencyStrategy: new SemaphoreStrategy(2),
            replacement: () =>
              new Promise<AsyncIterable<string>>((_, reject) =>
                abortController.signal.addEventListener("abort", () => reject(abortController.signal.reason), {
                  once: true
                })
              ),
            stopReplacingSignal: abortController.signal
          })
        );
        const unendedInput = new ReadableStream<Bytes>({
          start(controller) {
            controller.enqueue(utf8("a{{x}}b"));
          }
        });
        const reader = family
          .fromBytes(unendedInput)
          .pipeThrough(new TransformStream<C, C>(transformer))
          .getReader();
        await reader.read();
        await setImmediate();

        const unhandled = await unhandledRejectionsDuring(async () => {
          abortController.abort();
          for (let hop = 0; hop < hops; hop++) await Promise.resolve();
          await reader.cancel();
          await setImmediate();
        });

        expect(unhandled).toEqual([]);
      }
    );
  });

  describe(`${family.adapter} + SerialTransformEngine, with a fetch passed the stopReplacingSignal`, () => {
    it("ends the replacement after the part of the body it received when the signal aborts, without a try/catch", async () => {
      const abortController = new AbortController();
      const httpServer = await startTestHttpServer({
        "/fragment": () =>
          new Response(
            new ReadableStream<Utf8Bytes>({
              start(controller) {
                controller.enqueue(utf8("first"));
              }
            })
          )
      });

      try {
        const transformer = family.create(
          new SerialTransformEngine({
            searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
            replacement: async () => {
              const response = await fetch(`${httpServer.baseUrl}/fragment`, {
                signal: abortController.signal
              });
              return response.body!;
            },
            stopReplacingSignal: abortController.signal
          })
        );
        const reader = family
          .fromBytes(byteStreamOf([utf8("a{{x}}b")]))
          .pipeThrough(new TransformStream<C, C>(transformer))
          .getReader();

        let output = "";
        while (!output.endsWith("first")) output += family.textOf((await reader.read()).value!);
        abortController.abort();
        for (let read = await reader.read(); !read.done; read = await reader.read()) {
          output += family.textOf(read.value);
        }

        expect(output).toBe("afirstb");
      } finally {
        await httpServer.close();
      }
    });
  });

  describe(`${family.adapter}, with ReadableStream replacements that never yield, once the stream is cancelled`, () => {
    const splits = everyTwoWaySplit("a{{x}}b{{y}}c").map((chunks) => ({ chunks }));

    describe.each(stalledStreamReplacementEngines)("$engine", ({ called, create }) => {
      it.each(splits)("cancels each one it has called, whether or not it was being read, for $chunks", async ({ chunks }) => {
        const cancelled: string[] = [];
        const lastCall = Promise.withResolvers<void>();
        const engine = create(cancelled, (match) => {
          if (match === called.at(-1)) lastCall.resolve();
        });
        const stream = new TransformStream<C, C>(family.create(engine));
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        void (async () => {
          while (!(await reader.read()).done);
        })();
        for (const chunk of chunks) writer.write(family.chunkOf(chunk)).catch(() => {});
        await lastCall.promise;
        await setImmediate();

        await reader.cancel();
        await setImmediate();

        expect(cancelled.toSorted()).toEqual(called);
      });
    });
  });
}

describeWebAdapter(byteWebAdapter);
describeWebAdapter(textWebAdapter);
describeByteReplacements(byteWebAdapter);
describeByteReplacements(textWebAdapter);

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

  it.each(everyTwoWayByteSplit("\uFEFF{{name}}").map((chunks, splitAt) => ({ chunks, splitAt })))(
    "searches the text after a leading byte order mark, with the indices a TextDecoderStream gives, and keeps the mark at the start of the output, wherever the input is split (at byte $splitAt)",
    async ({ chunks }) => {
      const replaced = byteStreamOf(chunks).pipeThrough(
        new TransformStream(
          new ReplaceContentTransformer(
            new SerialTransformEngine({
              searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
              replacement: (_match, { streamIndices }) => JSON.stringify(streamIndices)
            })
          )
        )
      );

      await expect(new Response(replaced).bytes()).resolves.toEqual(
        utf8("\uFEFF[0,8]")
      );
    }
  );

  it.each(byteReplacementEngines)(
    "drops the byte order mark of a fragment an inner ReplaceContentTransformer re-scans, and keeps the one at the start of the outer input ($engine)",
    async ({ create }) => {
      const withByteOrderMark = (text: string) => byteStreamOf([utf8(`\uFEFF${text}`)]);
      const replaced = withByteOrderMark("a{{include}}b").pipeThrough(
        new TransformStream(
          new ReplaceContentTransformer(
            create(async () =>
              withByteOrderMark("<i>{{x}}</i>").pipeThrough(
                new TransformStream(
                  new ReplaceContentTransformer(
                    new SerialTransformEngine({
                      searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
                      replacement: "X"
                    })
                  )
                )
              )
            )
          )
        )
      );

      await expect(new Response(replaced).bytes()).resolves.toEqual(
        utf8("\uFEFFa<i>X</i>b")
      );
    }
  );

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
