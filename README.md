<p align="center">
  <h1 align="center">Replace Content Transformer</h1>
</p>
<p align="center">
A <a href="https://streams.spec.whatwg.org/#transformer-api">WHATWG Transformer</a> / Node <a href="https://nodejs.org/api/stream.html#class-streamtransform">stream.Transform</a> for replacing content.
</p>
<p align="center">
   <a href="https://github.com/TomStrepsil/replace-content-transformer/actions/workflows/github-code-scanning/codeql?query=branch%3Amain"><img src="https://github.com/TomStrepsil/replace-content-transformer/workflows/CodeQL/badge.svg" alt="CodeQL security analysis status" /></a>
   <a href="http://makeapullrequest.com"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs are welcome" /></a>
   <a href="https://github.com/TomStrepsil/replace-content-transformer/issues/"><img src="https://img.shields.io/github/issues/TomStrepsil/replace-content-transformer" alt="replace content transformer issues" /></a>
   <a href="https://github.com/TomStrepsil/replace-content-transformer/discussions/"><img src="https://img.shields.io/github/discussions/TomStrepsil/replace-content-transformer" alt="replace content transformer discussions" /></a>
   <img src="https://img.shields.io/github/stars/TomStrepsil/replace-content-transformer" alt="replace content transformer stars" />
   <img src="https://img.shields.io/github/forks/TomStrepsil/replace-content-transformer" alt="replace content transformer forks" />
   <img src="https://img.shields.io/github/license/TomStrepsil/replace-content-transformer" alt="replace content transformer license" />
   <a href="https://github.com/TomStrepsil/replace-content-transformer/graphs/commit-activity"><img src="https://img.shields.io/badge/Maintained%3F-yes-green.svg" alt="replace content transformer is maintained" /></a>
</p>

---

## 🐬 Purpose

**A toolkit for stream content replacement.**

Replace patterns in streaming data without needless buffering, or downstream delay.

- **Processes streams incrementally** - Transform gigabytes of data with constant memory usage
- **Never splits matches** - Correctly handles patterns that span chunk boundaries
- **Supports async or generated replacements** - Fetch dynamic content from APIs or databases and interpolate into streams
- **Works everywhere** - Native support for both WHATWG Streams (browsers, Deno, Bun, Edge runtimes, or Node) and Node.js streams

Perfect for server-side rendering, edge composition, log processing, template engines, content proxies, and any scenario where you need to transform text data as it flows through your application.

## ✨ Features

- 🪶 **Low dependency** - Lightweight and minimal [^1]
- 🚀 **Streaming-first** - Processes data as it arrives, yielding as early as possible
- 🎯 **Boundary-aware** - Correctly handles tokens split across chunk boundaries
- 🔮 **Eager discovery** - Supporting lookahead replacement, with configurable concurrency
- 🎨 **Dynamic content** - Replace with strings, functions, or iterables, sync or async
- ⏹️ **Cancellable** - Replacement can be halted mid-chunk
- ⏯️ **Pausable search** - Engines stop or pause the search at any match; the consuming stream has control
- ⚡ **Minimal setup overhead** - Stateless & re-usable search strategies
- 🔌 **Composable** - Pluggable search strategies & engines
- 📦 **TypeScript** - Full type definitions included

[^1]: a single peer dependency, enabling the regex search strategy

## 📦 Installation

```bash
npm install replace-content-transformer
```

[`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/) is a peer dependency. npm 7+, pnpm 8+, Bun and Deno install it automatically. Yarn doesn't, in either Classic (1.x) or Berry (2+), so add both:

```bash
yarn add replace-content-transformer regex-partial-match
```

## 🚀 Usage

See [Design](#-design) on composable parts to import and combine.

### WHATWG Transformer

The constructor is available from the `/web` import path:

```js
import { ReplaceContentTransformer } from "replace-content-transformer/web";
```

It accepts an engine (see [Engines](#-engines)):

```ts
const transformer = new ReplaceContentTransformer(engine: TransformEngine);
```

The transformer takes and emits UTF-8 bytes (`Uint8Array`), so a byte stream such as a `fetch` response body needs no other stage. e.g.

```typescript
const replaced = response.body!.pipeThrough(new TransformStream(transformer));
return new Response(replaced, response);
```

Multi-byte characters split across chunks are decoded intact. A byte order mark at the start of the input is kept at the start of the output but not searched, so a search strategy and `streamIndices` see the text a `TextDecoderStream` would decode. A string chunk errors the stream.

#### Streams of strings

Where the source is already strings, such as an LLM token stream or another text transform, use `ReplaceContentTextTransformer`, which takes and emits strings:

```js
import { ReplaceContentTextTransformer } from "replace-content-transformer/web";

const textTransformer = new ReplaceContentTextTransformer(engine);
const replaced = tokenStream.pipeThrough(new TransformStream(textTransformer));
```

`ReplaceContentTransformer` only reads UTF-8. For input in another encoding, decode it with a `TextDecoderStream` for that encoding, and use `ReplaceContentTextTransformer`:

```typescript
const replaced = readableStream
  .pipeThrough(new TextDecoderStream("shift_jis"))
  .pipeThrough(new TransformStream(textTransformer));
```

The output is strings. A `TextEncoderStream` can only encode them as UTF-8, so if they become a `Response` body, change any `charset` in its `Content-Type` to `utf-8`.

> [!NOTE]
> With the regex search strategy, string chunks must not split a surrogate pair. A `TextDecoder` or `TextDecoderStream` never does. See [Surrogate pairs split across chunks](./src/search-strategies/regex/README.md#️-surrogate-pairs-split-across-chunks).

> [!TIP]
> To encode a text transformer's output, note that on Node 22, on Node 24 before 24.21.0 and on Node 26 before 26.8.0, `TextEncoderStream` is slow: it costs about 5–10 ms per MB, often more than the replacement itself ([nodejs/node#65414](https://github.com/nodejs/node/pull/65414)). Upgrade, or encode with a `TextEncoder` in a `TransformStream` that, like `TextEncoderStream`, holds a trailing high surrogate back until the next chunk:
>
> ```typescript
> function utf8EncoderStream() {
>   const encoder = new TextEncoder();
>   let pending = "";
>   return new TransformStream<string, Uint8Array>({
>     transform(chunk, controller) {
>       const text = pending + chunk;
>       const last = text.charCodeAt(text.length - 1);
>       const splitsPair = last >= 0xd800 && last <= 0xdbff;
>       pending = splitsPair ? text.slice(-1) : "";
>       controller.enqueue(
>         encoder.encode(splitsPair ? text.slice(0, -1) : text)
>       );
>     },
>     flush(controller) {
>       if (pending) controller.enqueue(encoder.encode(pending));
>     }
>   });
> }
>
> const replacedStream = tokenStream
>   .pipeThrough(new TransformStream(textTransformer))
>   .pipeThrough(utf8EncoderStream());
> ```
>
> Calling `encoder.encode(chunk)` on each chunk on its own is not enough: an output chunk can end part-way through a surrogate pair, e.g. a match for `/a./` (no `u` flag) in `"a😀"` is `"a"` plus the first half of the emoji, and each half on its own encodes to U+FFFD.

### 👨‍🍳 Recipes

#### Single Static String Replacement

```typescript
import {
  SerialTransformEngine,
  searchStrategyFactory
} from "replace-content-transformer";
import { ReplaceContentTransformer } from "replace-content-transformer/web";

// {{needle}} replaced by "12345"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory("{{needle}}"),
    replacement: "12345"
  })
);
```

#### Replacing "Anchor" Delimiters (in sequence)

```typescript
// {{anything between braces}} replaced by "54321"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: "54321"
  })
);
```

#### Dynamic Replacement with Functions

Use a function for dynamic replacement, perhaps based on the original content:

```typescript
import { SerialTransformEngine } from "replace-content-transformer";

// "{{this}} and {{that}}" becomes "this was match 0 and that was match 1"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: (match: string, { matchIndex }: { matchIndex: number }) =>
      `${match.slice(2, -2)} was match ${matchIndex}`
  })
);
```

Access the character indices of the match, relative to the start of the stream:

```typescript
// "here's {{this}}" becomes "here's this, found from 7 to 15"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: (
      match: string,
      {
        streamIndices
      }: {
        streamIndices: [startIndex: number, endIndex: number];
      }
    ) =>
      `${match.slice(2, -2)}, found from ${streamIndices[0]} to ${streamIndices[1]}`
  })
);
```

> [!NOTE]
> `streamIndices[1]` (endIndex) is exclusive, following the same convention as [`String.prototype.slice(startIndex, endIndex)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice) [^2]

[^2]: See [half-open intervals](<https://en.wikipedia.org/wiki/Interval_(mathematics)#Half-open_intervals>)

#### Replacing a Regular Expression

```typescript
// `class="anything old-button"` becomes `class="anything new-button"`
// `class="old-button something else"` becomes `class="new-button something else"`
// `class="cold-button"` remains `class="cold-button"`
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(
      /class="(?<before>(?:[^"]*? )?)old-button(?<after>(?: [^"]*?)?)"/
    ),
    replacement: (match) => {
      const { before, after } = match.groups;
      return `class="${before}new-button${after}"`;
    }
  })
);
```

A backreference lets a pattern tie a later part of the match back to something it already captured — e.g. a quote-agnostic string literal, where whatever character opened the string (`'`, `"`, or `` ` ``) is also whatever has to close it, rather than a fixed character baked into the pattern:

```typescript
// `name = 'Alice'` becomes `name = 'REDACTED'`
// `greeting = "hi there"` becomes `greeting = "REDACTED"`
// `code = `raw`` becomes `code = `REDACTED``
// `text = "it's fine"` becomes `text = "REDACTED"` — the apostrophe inside is just content; the backreference, not a fixed quote character, is what decides where the string actually ends
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(/(['"`])(?:\\.|[^\\])*?\1/),
    replacement: (match) => {
      const quote = match[1];
      return `${quote}REDACTED${quote}`;
    }
  })
);
```

> [!CAUTION]
> The `regex` search strategy is marginally less performant than static string anchors, and does not support all regular expression features. See [limitations](./src/search-strategies/regex/README.md#limitations) — backreferences and positive lookaheads in particular carry their own streaming-specific caveats, documented in that same section.

#### Replacing Balanced Pairs (respecting nesting)

Match and replace delimiter pairs that may be nested, using `BalancedPairSearchStrategy`. The match only completes when the outermost pair is fully balanced:

```typescript
import { BalancedPairSearchStrategy } from "replace-content-transformer";

// "(a (b) c)" becomes "[a (b) c]"
// "(d)" becomes "[d]"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: new BalancedPairSearchStrategy("(", ")"),
    replacement: (match: string) => `[${match.slice(1, -1)}]`
  })
);
```

#### Async Replacement

Replace with asynchronous content. Ensures each async replacement completes before the next search starts.

```typescript
import { SerialTransformEngine } from "replace-content-transformer";
import { ReplaceContentTransformer } from "replace-content-transformer/web";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `<img src="file://image.png">` becomes "<img src="data:image/png;base64,...>"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["<img", 'src="file://', '.png">']),
    replacement: async (imgTag: string) =>
      `<img src="data:image/png;base64,${(
        await fs.readFile(
          path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            imgTag.match(/\/\/(.+?)"/)[1]
          )
        )
      ).toString("base64")}">`
  })
);
```

A function may return synchronously for some matches and asynchronously for others, as with a cache. A synchronous result is replaced straight away; only an asynchronous one pauses the search:

```typescript
// "{{a}} {{b}} {{a}}" becomes the values of a and b, looking each up once
declare const remoteKeyValueStore: { get(key: string): Promise<string> };

const cache = new Map<string, string | Promise<string>>();
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: (match: string): string | Promise<string> =>
      // a Promise the first time, which pauses the search
      cache.getOrInsertComputed(match, async (key) => {
        const value = await remoteKeyValueStore.get(key);
        cache.set(key, value); // later hits get the string, replaced straight away
        return value;
      })
  })
);
```

> [!TIP]
> For **pipelined** async replacement — where later matches should be discovered and their async work started while earlier replacements are still in flight, without sacrificing in-order output or letting concurrency run away — use [`LookaheadTransformEngine`](#pipelined-async-replacement-with-lookaheadtransformengine) (see below).

#### Iterable Replacement

Interpolate a sequence of strings, UTF-8 bytes (`Uint8Array`), or both, into the stream:

```typescript
// "1 2 3 4 5" becomes "1 2 3.1 3.2 3.3 4 5"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory("3 "),
    replacement: () => [...Array(3)].map((_, i) => `3.${i + 1} `)
  })
);
```

#### Async Iterable Replacement

Interpolate [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)s, or other async iterables, into the output. Ensures each async operation completes before the next starts:

You can return either form:

- an async iterable directly (for example `async function*`)
- a `Promise` of one (for example an `async` function returning a stream)

It can yield strings, UTF-8 bytes (`Uint8Array`), or both, so a `fetch` response body can be returned as it is:

```typescript
// `<div><esi:include src="https://example.com/foo" /></div>` fills the `<div>` with content fetched from https://example.com/foo
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["<esi:include", "/>"]),
    replacement: async (match, { signal }) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      return (await fetch(url, { signal })).body!;
    }
  })
);

// direct async iterable form
const transformerWithGenerator = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory("{{needle}}"),
    replacement: async function* () {
      yield "first chunk";
      yield "second chunk";
    }
  })
);
```

The engine reads each replacement's bytes as one sequence: a character split across a fragment's chunks is kept whole, and one a fragment leaves incomplete, or a malformed byte, becomes U+FFFD. `ReplaceContentTransformer` and `ReplaceContentTransform` emit valid bytes without decoding them and encoding them again. With `ReplaceContentTextTransformer`, `ReplaceContentTransform` in `readableObjectMode` (whose output is strings only), or a sink of your own (see [Engines](#-engines)), the engine decodes them, so the output is the same text with any adapter. Bytes returned synchronously, alone or in an iterable, are decoded into the output whatever the sink. In every case, a byte order mark at the start of a replacement's bytes, or of bytes that follow a string it yields, is dropped, as a `TextDecoderStream` drops one at the start of its input, since it would otherwise land in the middle of the output.

> [!NOTE]
> The adapters copy the bytes they emit, so a replacement may reuse its buffer for its next chunk, and each chunk `ReplaceContentTransformer` emits has its own `ArrayBuffer`, so downstream may transfer it, as a byte stream does when enqueuing it.

#### Pipelined Async Replacement with `LookaheadTransformEngine`

For I/O-bound replacements (fragment fetches, [KV](https://en.wikipedia.org/wiki/Key%E2%80%93value_database) lookups, etc.) the `SerialTransformEngine` above processes matches **serially** — the next match isn't even looked for until the current replacement has fully streamed to the output. That means later matches wait idle while earlier replacements are still in flight, even if they could be running concurrently.

`LookaheadTransformEngine` scans ahead and initiates later matches' replacement work while earlier ones are still in flight, preserving in-order output. A pluggable `ConcurrencyStrategy` controls when and in what order work is dispatched (including explicit unfettered dispatch via `new SemaphoreStrategy(Infinity)`), and replacements can opt in to recursive re-scanning via the `nested()` sentinel.

```typescript
import {
  LookaheadTransformEngine,
  SemaphoreStrategy,
  searchStrategyFactory
} from "replace-content-transformer";

const transformer = new ReplaceContentTransformer(
  new LookaheadTransformEngine({
    searchStrategy: searchStrategyFactory(["<esi:include", "/>"]),
    concurrencyStrategy: new SemaphoreStrategy(8),
    replacement: async (match, { signal }) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      return (await fetch(url, { signal })).body!;
    }
  })
);
```

See the [full documentation](./src/engines/lookahead-transform-engine/README.md) for usage examples, concurrency strategies, backpressure/`highWaterMark`, cancellation, and recursive composition.

#### Manage Recursion

Recursive replacement, with controlled depth:

```typescript
const searchStrategy = searchStrategyFactory(["<esi:include", "/>"]);
const maxDepth = 3;
function engineFor(currentDepth: number): TransformEngine {
  return new SerialTransformEngine({
    searchStrategy,
    replacement: async (match, { signal }) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const { body } = await fetch(url, { signal });
      return currentDepth < maxDepth
        ? body!.pipeThrough(
            new TransformStream(
              new ReplaceContentTransformer(engineFor(currentDepth + 1))
            )
          )
        : body!;
    }
  });
}
// replaces esi include tags, recursively in fetched content, to a max depth of 3
const transformer = new ReplaceContentTransformer(engineFor(0));
```

Each fragment is decoded once, by the transformer that searches it, and encoded once, in that transformer's output. The levels above pass its bytes through.

> [!NOTE]
> When using `matchIndex` / `streamIndices` from context, these will be specific to each engine instance, thus may not be the holistic "indexes into the stream".

#### Limit replacements

To abort replacement after a certain number of replacements (or, for any other reason), provide an [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) via the engine's `stopReplacingSignal` option:

```ts
const abortController = new AbortController();
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
    replacement: async (match, { matchIndex, signal }) => {
      if (matchIndex === 1) {
        abortController.abort(); // after two replacements, stop replacing
      }
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const response = await fetch(url, { signal });
      return response.ok ? response.body! : match;
    },
    stopReplacingSignal: abortController.signal
  })
);
```

This will ensure the transform is ["pass through"](https://en.wikipedia.org/wiki/Identity_transform) once the abort is signalled.

With either engine, no replacement is called once the signal has aborted, and one already called runs to completion. To end an iterable replacement early, have it check the signal between pieces, returning or calling `signal.throwIfAborted()`. A consumer can abort it, or cancel the stream, on seeing some output: WHATWG readers, `pipeTo()` and `for await` receive output once the engine has finished with a chunk or is awaiting a replacement, so that takes effect from the next chunk, or straight after an awaited replacement that settles after the abort. For a Node consumer, see [Stopping on output](#stopping-on-output).

To also stop requests already in flight, pass the signal to `fetch`, combined with the context's own `signal` (see [Stream cancellation](#stream-cancellation)). A replacement that fails with the signal's `reason` or an `AbortError`, as `fetch` and its body do once it aborts, ends there instead of erroring the stream: its match is emitted verbatim if it had produced nothing, and otherwise only what it produced, even part way through a body:

```ts
const abortController = new AbortController();
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
    replacement: async (match, { signal }) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, abortController.signal])
      });
      return response.ok ? response.body! : match;
    },
    stopReplacingSignal: abortController.signal
  })
);
someEventBus.once("someEvent", () => abortController.abort());
```

So does a replacement that fails with an error with either of those in its `cause` chain, such as the error Node's `stream.addAbortSignal` fails with, or an error wrapping that one. A Node `http.get` given the signal fails that way only until its response arrives, and on Deno only from 2.7.13, whose earlier `node:http` rejects without the `cause`. To end the response part way through too, return `addAbortSignal(signal, response)`.

#### Stream cancellation

The replacement context's `signal` belongs to the engine, and is separate from `stopReplacingSignal`. It aborts once the replacement's output is no longer wanted: when the stream is cancelled or destroyed before it ends, and, with `LookaheadTransformEngine`, when `abandonPendingSignal` abandons the replacement before its output has begun. The engine cancels a `ReadableStream` it has been given, such as a `fetch` body, whether or not the signal is passed. What the signal adds: pass it to `fetch`, as the recipes above do, so a request whose response hasn't arrived yet stops straight away, and pass it to a source the engine can't cancel itself, such as a Node `Readable` through `addAbortSignal`, or a generator waiting on other work, which the engine could otherwise close only at its next chunk. A replacement that fails because of the abort, with the signal's `reason` or an `AbortError`, doesn't error the stream.

> [!NOTE]
> Once a WHATWG stream's input has ended, a cancel of its output waits for `flush()` to finish, and the transformer isn't told of it: by design, a transformer's [`flush` and `cancel` are never both called](https://github.com/whatwg/streams/pull/1283) ([spec](https://streams.spec.whatwg.org/#transform-stream-default-source-cancel)). `ReplaceContentTransformer` and `ReplaceContentTextTransformer` cancel the engine at the next piece the cancelled stream refuses, and the signal aborts then. An engine of your own that has no `cancel()`, or whose `cancel()` throws, has that `enqueue` throw instead. A replacement that stalls before its next piece, such as a stalled `fetch`, holds up the cancel, its `signal` doesn't abort, and with `LookaheadTransformEngine` it keeps its concurrency slot. Give it a signal that does abort: `AbortSignal.any([signal, request.signal])` where your server aborts a `request.signal` when the client disconnects, or `AbortSignal.timeout()`. Bun passes the cancel on from 1.4.0, the minimum this package supports. `ReplaceContentTransform` cancels the engine whenever the stream is destroyed before it ends.

### Node Transform

Use the Node adapter (`ReplaceContentTransform`) for a native [`stream.Transform`](https://nodejs.org/api/stream.html#class-streamtransform) implementation, if performance cost of [`toWeb`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options) / [`fromWeb`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options) conversion is a concern.

> [!CAUTION]
> **Encoding**: this adapter decodes `Buffer` input as UTF-8, keeping a multi-byte character intact across chunk boundaries. Non-UTF-8 byte streams will be mis-decoded silently: decode upstream with a [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder) for the source charset (calling `decode(chunk, { stream: true })` per chunk) and write strings with `decodeStrings: false`. Output is always UTF-8, with a surrogate pair split across output chunks encoded as one character; to re-encode it to a legacy charset, use a library such as [`iconv-lite`](https://www.npmjs.com/package/iconv-lite), since `TextEncoder` only produces UTF-8. A string written with Node's default `decodeStrings: true` is converted to a `Buffer` using the encoding passed to `write()` (or `defaultEncoding`) and then decoded as UTF-8; with `decodeStrings: false`, string chunks reach the engine unchanged, a leading U+FEFF included, as a `TextDecoder` upstream has already removed any byte order mark. A byte order mark at the start of the input the adapter decodes is kept at the start of the output but not searched, so a search strategy and `streamIndices` see the text a `TextDecoder` would decode.

`ReplaceContentTransform` shares the same engines and options as its web counterpart, so pipelined in-order async replacement, nested `nested()` re-scanning, bounded concurrency, and `highWaterMark` backpressure behave identically across runtimes. The standard `TransformOptions.highWaterMark` controls Node-stream backpressure independently of the engine's own `highWaterMark`.

```typescript
// streaming esi middleware for express.js, using native Node.js stream.Transform
import { responseHandler } from "express-intercept";
import { ReplaceContentTransform } from "replace-content-transformer/node";
import {
  LookaheadTransformEngine,
  SemaphoreStrategy,
  searchStrategyFactory,
  nested
} from "replace-content-transformer";
import type { Readable } from "node:stream";
import { get } from "node:https";

const searchStrategy = searchStrategyFactory(["<esi:include", "/>"]);
const maxDepth = 3;
function transformFactory() {
  return new ReplaceContentTransform(
    new LookaheadTransformEngine({
      searchStrategy,
      concurrencyStrategy: new SemaphoreStrategy(8),
      replacement: async (match, { depth }) => {
        const {
          groups: { url }
        } = /src="(?<url>[^"]+)"/.exec(match)!;
        const nodeStream = await new Promise<Readable>((resolve, reject) => {
          get(url, resolve).on("error", reject);
        });
        return depth < maxDepth ? nested(nodeStream) : nodeStream;
      }
    })
  );
}
const expressMiddleware = responseHandler()
  .if((res) => /html/i.test(res.getHeader("content-type")))
  .interceptStream((upstream: Readable, _, res) => {
    res.removeHeader("content-length");
    return upstream.pipe(transformFactory());
  });
```

#### Stopping on output

With `SerialTransformEngine` and a `stopReplacingSignal`, output is pushed as it is produced. So a `data` listener or `pipe()` destination that aborts the signal, or destroys the stream, on seeing some output prevents every replacement after it, even within a chunk. Each piece of an iterable replacement is pushed as it is produced too, so a generator that checks the signal before yielding the next piece sees such an abort. This holds only while the consumer keeps up, as Node passes output on straight away only while the stream is flowing with nothing buffered. When a consumer isn't reading yet, reads with `for await`, or is a `pipe()` destination still writing earlier output, later replacements may already have been called by the time it sees the output.

Where a replacement must never run, decide from the input instead: search for the deciding text too, so the replacement function sees it first, or inspect the input upstream.

## 🧬 Design

The library uses a composable architecture that finds and replaces patterns across chunk boundaries.

It has separated concerns:

1. **[Search Strategies](#-search-strategies)** - Define _what_ to match (e.g., literal strings, arrays of strings as anchors, regular expressions)
2. **[Engines](#-engines)** - Orchestrate search and replacement, receiving each result from the strategy through a sink

### 🔍 Search Strategies

Pluggable strategies implement the `SearchStrategy` interface:

```typescript
type StreamIndices = [startIndex: number, endIndex: number];

interface MatchSink<TMatch = string> {
  reportText(content: string): void;
  reportMatch(content: TMatch, streamIndices: StreamIndices): boolean;
}

interface SearchStrategy<TState, TMatch = string> {
  createState(): TState;
  processChunk(
    haystack: string,
    state: TState,
    sink: MatchSink<TMatch>
  ): undefined;
  flush(state: TState): string;
  settle?(state: TState, sink: MatchSink<TMatch>): undefined;
  matchToString(match: TMatch): string;
}
```

Strategies report to a sink rather than returning or yielding results. Each result is handled as it is found, with no iterator step per result, and the engine can stop or pause the scan at any match (see `reportMatch` below). A strategy can also wrap another's sink, as `BalancedPairSearchStrategy` does to count nesting around an anchor strategy. Against a generator, the sink is 1.03–1.7x faster across the streaming scenarios of the algorithm benchmarks, about 1.2x in a typical one, with each run alone in its process (see [Engine shapes](./test/benchmarks/references/README.md#-engine-shapes)).

The `processChunk` reports the chunk to the sink in stream order: literal content through `reportText`, and each match through `reportMatch`. `processChunk` and `settle` return `undefined` rather than `void`, so a strategy still written as a generator is a type error rather than one that silently reports nothing.

The `TState` type is specific to the strategy, managed by the consuming engine / stream, to keep the strategies stateless. This means any construction cost can be reduced, with strategies re-used across multiple streams.

The `TMatch` type (defaulting to `string`) allows strategies like `RegexSearchStrategy` to return richer match data, including capture groups and stream-relative indices. Regex matches use the exported `StreamRegexMatch` type. The native `RegExpExecArray.input` identifies one scan buffer rather than the complete stream, so the strategy sets it to `undefined`.

The `flush` returns anything the strategy is still holding as raw text, without searching it, and re-sets the provided state parameter for re-use. The engine calls it at the end of the stream when the strategy has no `settle`, and once `stopReplacingSignal` has aborted.

The optional `settle` is called by the engine in place of `flush` at the end of the stream, unless `stopReplacingSignal` has aborted, to decide anything the strategy is still holding. It reports to the sink as `processChunk` does, so a strategy that deferred a decision at the final chunk boundary can still report a real match — `RegexSearchStrategy` re-scans its buffer with the original pattern and emits whatever it finds. It also re-sets the state.

`reportMatch` returns whether to carry on. When it returns `false`, the strategy returns at once, leaving everything after that match in the state. From there, the engine either calls `flush` to emit it verbatim, as it does once `stopReplacingSignal` aborts, or carries on where the search stopped by calling `processChunk` with `""` (or `settle` again). Either call has to wait until `processChunk` (or `settle`) has returned: the state is only complete once it has. `SerialTransformEngine` pauses like this at a match whose replacement it awaits, and `LookaheadTransformEngine` at a match that fills its queue. Either engine can pause like this at every match, so join what the state holds to a chunk only when neither is empty: on Bun, a string joined with `""` is copied when it is next searched, which costs the rest of the chunk at every match ([WebKit bug 332729](https://bugs.webkit.org/show_bug.cgi?id=332729)). The built-in strategies leave the rest in the state from a `finally` block, which also keeps the state intact if a sink call throws.

The `matchToString` converts a match back to the raw matched text, for a match emitted verbatim.

> [!NOTE]
> The `streamIndices` property contains absolute character offsets into the stream passed to the engine as `[startIndex, endIndex]`, thus not chunk-relative.

Each strategy contains the pattern-matching logic for a specific use case:

- **[`StringAnchorSearchStrategy`](./src/search-strategies/looped-indexOf-anchored/README.md)** - finds either single tokens, or "anchor" tokens delimiting start/end (or in sequence in-between) of a match
- **[`BalancedPairSearchStrategy`](./src/search-strategies/balanced-pair/README.md)** - Matches balanced delimiter pairs, correctly handling arbitrary nesting depth (e.g. `(outer (inner) rest)`)
- **[`RegexSearchStrategy`](./src/search-strategies/regex/README.md)** - Matches against regular expressions (with some caveats)
  - **[`LeanRegexSearchStrategy`](./src/search-strategies/regex/README.md#lean-bundles)** - The same, taking a `PartialMatchRegExp` you build from `regex-partial-match/core`, for a smaller bundle

See [search strategies](./src/search-strategies/README.md) for detail of functionality, and development of the strategies.

#### Buffer limit

A match can span chunks, so a strategy holds back content that could still become part of one. Every strategy, and `searchStrategyFactory`, caps this with `maxBufferLength`, in UTF-16 code units (65,536 by default): a match still incomplete that far from its start has `onGuardExceeded` called, then passes through as text up to there, and the search restarts right after. Output stays lossless, and doesn't depend on how the input is split. `Infinity` removes the cap. For the string strategies, a limit shorter than the anchors together throws a `RangeError`, since nothing could match.

```ts
new StringAnchorSearchStrategy(["<esi:include", "/>"], {
  maxBufferLength: 16 * 1024,
  onGuardExceeded: () =>
    console.warn("an <esi:include> passed through unreplaced")
});
```

##### What `onGuardExceeded` can do

`onGuardExceeded` is called synchronously, before the text it releases is emitted, from the search that takes a held match past the limit. That search usually runs in a `write()`, but can also run as the stream closes or, for [`nested()`](./src/engines/lookahead-transform-engine/README.md#recursive-replacement) content, as output drains. The callback can:

- **Notify**, as above: the match passes through as text, and replacing carries on.
- **Stop replacing:** abort the engine's [`stopReplacingSignal`](#limit-replacements). The released text, and the rest of the stream, pass through verbatim, except that `LookaheadTransformEngine` still runs a replacement it has already called, such as one for an outer match found after the `nested()` content in which the limit was crossed. It also passes through an earlier match whose replacement it hasn't called yet, even one in the same `write()`, [as for any abort](./src/engines/lookahead-transform-engine/README.md#stopping-new-replacements-stopreplacingsignal). The callback may run again later in the same chunk, so make it safe to repeat.

  ```ts
  const stopReplacing = new AbortController();
  new SerialTransformEngine({
    searchStrategy: new StringAnchorSearchStrategy(["<esi:include", "/>"], {
      onGuardExceeded: () => stopReplacing.abort()
    }),
    replacement,
    stopReplacingSignal: stopReplacing.signal
  });
  ```

- **Fail closed:** throw. The stream errors with what was thrown (`ReplaceContentTransform` wraps a non-`Error` in one). What was held is lost, as is output the consumer hasn't read yet. `LookaheadTransformEngine` also loses anything it hadn't emitted, such as a replacement still in flight, the text after it, or text found earlier in the same `write()`.

  ```ts
  new StringAnchorSearchStrategy(["<esi:include", "/>"], {
    onGuardExceeded: () => {
      throw new Error("an <esi:include> was not closed");
    }
  });
  ```

### 🏭 Search Strategy Factory

If tree-shaking is not a concern, a factory method for generating a search strategy based on appropriate input is available:

```ts
import { searchStrategyFactory } from "replace-content-transformer";
searchStrategyFactory(input: RegExp, options?: RegexSearchStrategyOptions): RegexSearchStrategy;
searchStrategyFactory(input: string | string[], options?: BufferGuardOptions): StringAnchorSearchStrategy;
```

The `options` are [`maxBufferLength` and `onGuardExceeded`](#buffer-limit), passed to whichever strategy is built. Given a `RegExp`, they may also include `minCandidateLengthToBackOff` and `bufferGrowthFactorBetweenEvaluations` (see [Unbounded Quantifiers](./src/search-strategies/regex/README.md#️-unbounded-quantifiers)). An input typed only as `string | string[] | RegExp` takes `BufferGuardOptions`, and returns either strategy.

> [!IMPORTANT]
> The `BalancedPairSearchStrategy` is not returned by this factory, since it cannot be determined from input, so import this directly, as described below.

However, if choice of string vs regular expression requirement is known at design time, a smaller bundle will be afforded by importing a strategy directly:

```ts
import { StringAnchorSearchStrategy } from "replace-content-transformer";
const searchStrategy = new StringAnchorSearchStrategy(["<!--replace me -->"]); // single token
```

...or:

```ts
const searchStrategy = new StringAnchorSearchStrategy(["{{", "}}"]); // 2+ "anchor" delimiters/tokens
```

...or:

```ts
import { BalancedPairSearchStrategy } from "replace-content-transformer";
const searchStrategy = new BalancedPairSearchStrategy("{{", "}}"); // delimiter pair, nesting aware
```

> [!IMPORTANT]
> Anchors and delimiters must be non-empty — an empty string is rejected at construction, since `indexOf("")` would never advance the scan.

...or:

```ts
import { RegexSearchStrategy } from "replace-content-transformer";
const searchStrategy = new RegexSearchStrategy(/<div>.+?<\/div>/s); // regular expression for complete match
```

...or, smaller again, bringing your own [lean](./src/search-strategies/regex/README.md#lean-bundles) `PartialMatchRegExp`:

```ts
import PartialMatchRegExp from "regex-partial-match/core";
import { LeanRegexSearchStrategy } from "replace-content-transformer";
const searchStrategy = new LeanRegexSearchStrategy(
  new PartialMatchRegExp(/<div>.+?<\/div>/s)
);
```

### 🦾 Engines

Engines process chunks from the `Transformer` (web) / `stream.Transform` (node), orchestrating replacement using a search strategy. They implement one interface:

```typescript
interface TransformEngine {
  start(sink: EngineSink): void;
  write(chunk: string): void | Promise<void>;
  end(): void | Promise<void>;
  cancel?(): void;
}
```

`write()` and `end()` return `undefined` when the call completed synchronously, or a `Promise` the adapter waits for before its next call.

The `EngineSink` receives the output as strings. A `ByteEngineSink`, which sets `acceptsBytes: true`, as `ReplaceContentTransformer` and `ReplaceContentTransform` do, also receives the UTF-8 bytes a replacement produces asynchronously, in order with the strings around them, without their being decoded. Each chunk of bytes is valid UTF-8 that ends at a character boundary, and may be a view of the replacement's own buffer, so a sink that keeps one past `enqueue` must copy it.

> [!CAUTION]
> Engines should only be driven by an adapter. Adapters call `write()` and `end()` one at a time, which keeps output in order and buffered text intact.

There are two concrete engines:

- **`SerialTransformEngine`** — serial replacement, synchronous or asynchronous. Each match is fully replaced before the engine searches for the next. `replacement` can be a plain `string` for static replacement, or a function returning a `string`, UTF-8 bytes (`Uint8Array`), an `Iterable` or `AsyncIterable` of strings or bytes (e.g. a `ReadableStream`, such as a `fetch` body), or a `Promise` of any of these
  - A function can return synchronously for some matches and asynchronously for others (see [Async Replacement](#async-replacement)):
    - a `string`, bytes or `Iterable` goes straight into the output, and the search carries on
    - a `Promise` or `AsyncIterable` pauses the search until it has been fully read
  - An iterable must yield strings or bytes, not Promises. To yield Promises, return an async generator instead, e.g. `async function* () { yield* promises; }`, which awaits each in turn
  - Output arrives in as few chunks as possible. With a `stopReplacingSignal`, a Node consumer gets it piece by piece instead, so it can stop replacements as soon as it sees something (see [Stopping on output](#stopping-on-output))

- **`LookaheadTransformEngine`** — concurrent pipelined replacement. Scans ahead and initiates replacement work for later matches while earlier ones are still in flight, preserving in-order output. Uses a pluggable `ConcurrencyStrategy` and supports recursive re-scanning via the `nested()` sentinel. See the [full documentation](./src/engines/lookahead-transform-engine/README.md)

An engine drives its search strategy through a `MatchSink`, along these lines:

```typescript
let stoppedAt: string | undefined;
const sink: MatchSink<TMatch> = {
  reportText: (content) => output.enqueue(content),
  reportMatch: (content, streamIndices) => {
    if (stopReplacingSignal?.aborted) {
      stoppedAt = this.searchStrategy.matchToString(content);
      return false;
    }
    output.enqueue(/* some replacement form (static, functional, iterator, async...) */);
    return true;
  }
};
write(chunk: string) {
  this.searchStrategy.processChunk(chunk, this.searchState, sink);
  if (stoppedAt !== undefined) {
    /* the match verbatim, then the rest of the chunk and anything held */
    output.enqueue(stoppedAt + this.searchStrategy.flush(this.searchState));
    stoppedAt = undefined;
  }
}
end() {
  if (this.searchStrategy.settle) {
    this.searchStrategy.settle(this.searchState, sink);
  } else {
    const held = this.searchStrategy.flush(this.searchState);
    if (held) output.enqueue(held);
  }
}
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:ci

# Run benchmarks ("looped indexOf anchored" search strategy, on Node runtime)
npm run bench

# Run runtime benchmarks (as above, but across Node, Deno and Bun, where installed)
npm run bench:runtimes

# Run algorithm benchmarks (comparing algorithms - most not exported, for comparison)
npm run bench:algorithms

# Lint code
npm run lint

# Build
npm run build
```

## 🧪 Testing

### Unit Tests

- **Search Strategies** - Pattern matching algorithms for single tokens, anchor sequences, and regular expressions
- **Engines** - Serial (sync or async) and lookahead replacement logic
- **Adapters** - WHATWG Transformer and Node.js stream.Transform implementations
- **Factory Functions** - Strategy factory and helper utilities

### Integration Tests

- **Cross-component** - Engines combined with search strategies
- **Streaming scenarios** - Transformers with engines in stream pipelines
- **Promise handling** - Async replacement functions and promise-based workflows
- **Abort signals** - Cancellation and signal propagation

### Exhaustive Chunk-Boundary Tests

For each pattern in a curated table, the regex search strategy is driven over **every** two-way split of the input, every three-way split, and a character-by-character split, asserting:

- **Chunk invariance** - the match sequence is identical however the input was split, and equal to the non-streaming result
- **Lossless output** - concatenating every reported result plus `flush()` reproduces the input exactly

The table deliberately includes the shapes most exposed to chunk boundaries — eager quantifiers, alternation branches that could still grow, a terminator the pattern's own body can consume, and lookaheads whose assertion reaches past the text the match consumes — so invariance is verified rather than assumed. What varies legitimately is _buffering_, documented under [Unbounded Quantifiers](./src/search-strategies/regex/README.md#️-unbounded-quantifiers), not the matches produced, except where a chunk ends more than 64 characters into the text a backreference repeats (see [Backreferences](./src/search-strategies/regex/README.md#️-backreferences)).

### Functional Validation Tests

- **Algorithm comparison** - 18 harnesses, each a search strategy with an engine shape, validated against identical test scenarios:
  - Single and multi-chunk replacements
  - Tokens split across chunk boundaries at various positions
  - Consecutive and nested patterns
  - False starts and pathological cases (repetitive characters, long tokens)
  - Edge cases (empty content, incomplete patterns, LaTeX-like nested braces)
  - Real-world scenarios (HTML templating, cross-boundary matches)

All tests run across multiple runtimes (Node.js, Bun, Deno) in CI. See [Benchmarks](./test/benchmarks/README.md) for performance analysis.

## 🌐 Compatibility

This library uses the [WHATWG Streams API](https://streams.spec.whatwg.org/) and is compatible with multiple JavaScript runtimes:

### ✅ Fully Supported Runtimes

- **Node.js** 22.0.0+ (`TextEncoderStream` is much faster from 24.21.0 and 26.8.0; see [WHATWG Transformer](#whatwg-transformer))
- **Bun** 1.4.0+
- **Deno** 1.38+
- **Browsers:**
  - Chrome 85+
  - Firefox 102+
  - Safari 15+
  - Edge 85+
- **Edge Workers:**
  - Cloudflare Workers
  - Vercel Edge Functions
  - Akamai EdgeWorkers
  - Fastly Compute

Some browsers fail an aborted `fetch` or its body with an `AbortError` of their own rather than the `stopReplacingSignal`'s reason, as do those without [`AbortSignal.reason`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/reason) (Chrome and Edge before 98, Safari before 15.4). A replacement failing with an `AbortError` ends cleanly too, so these work the same. A replacement that checks the signal itself where [`throwIfAborted()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted) is missing (Chrome and Edge before 100, Safari before 15.4) can throw `new DOMException("Aborted", "AbortError")`.

`LookaheadTransformEngine` also needs [`AbortSignal.any()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static): Chrome and Edge 116+, Firefox 124+, Safari 17.4+ and Deno 1.39+.

A regex search strategy also needs whatever its pattern's own syntax needs, such as the `v` flag. See `regex-partial-match`'s [Compatibility](https://github.com/TomStrepsil/regex-partial-match/blob/main/docs/compatibility.md).

## 📜 License

- [ISC](./LICENSE)

## 👤 Author

Tom Pereira - [GitHub](https://github.com/TomStrepsil)

## 🤝 Contributing

Contributions are welcome!

Please feel free to raise an [Issue](https://github.com/TomStrepsil/replace-content-transformer/issues) and/or submit a Pull Request.

## 📚 References

- [replacing TransformStream example](https://streams.spec.whatwg.org/#example-ts-lipfuzz)
- [node:stream/web](https://nodejs.org/api/webstreams.html) - Node.js WHATWG Streams implementation
- [TransformStream API](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream) - MDN documentation

## 🔗 Related Projects

- [regex-partial-match](https://github.com/TomStrepsil/regex-partial-match/) - companion project powering the `regex` search strategy
- [parse5-html-rewriting-stream](https://parse5.js.org/classes/parse5-html-rewriting-stream.RewritingStream.html) - a Streaming [SAX](https://en.wikipedia.org/wiki/Simple_API_for_XML)-style HTML rewriter
- [stream-replace-string](https://github.com/ChocolateLoverRaj/stream-replace-string) - A Node stream transform (abandoned)
- [replacestream](https://github.com/eugeneware/replacestream) - a Node stream transform, supporting regex matching (last update 2016)
- [string-searching](https://github.com/string-searching) - various string searching algorithms in javascript
- [balanced-match](https://github.com/juliangruber/balanced-match/) - balanced string matching
