# Adapters

An adapter runs an [engine](./engines.md) as a stream.

| Adapter                         | Type                                        | Import                             | Takes                | Emits                                            |
| ------------------------------- | ------------------------------------------- | ---------------------------------- | -------------------- | ------------------------------------------------ |
| `ReplaceContentTransformer`     | `Transformer`, for `new TransformStream()`  | `replace-content-transformer/web`  | UTF-8 `Uint8Array`   | UTF-8 `Uint8Array`                               |
| `ReplaceContentTextTransformer` | `Transformer`, for `new TransformStream()`  | `replace-content-transformer/web`  | strings              | strings                                          |
| `ReplaceContentStream`          | `ReadableWritablePair`, for `pipeThrough()` | `replace-content-transformer/web`  | UTF-8 `Uint8Array`   | UTF-8 `Uint8Array`                               |
| `ReplaceContentTextStream`      | `ReadableWritablePair`, for `pipeThrough()` | `replace-content-transformer/web`  | strings              | strings                                          |
| `ReplaceContentTransform`       | `stream.Transform`                          | `replace-content-transformer/node` | `Buffer`s or strings | UTF-8 `Buffer`s; strings in `readableObjectMode` |

All of them take the same engines and options, so concurrency, `nested()` re-scanning and the engine's `highWaterMark` behave the same in each.

## WHATWG streams

`ReplaceContentTransformer` reads a byte stream, such as a `fetch` response body, with no other stage:

```typescript
import { ReplaceContentTransformer } from "replace-content-transformer/web";

const replaced = response.body!.pipeThrough(
  new TransformStream(new ReplaceContentTransformer(engine))
);
return new Response(replaced, response);
```

A string chunk errors the stream.

### Streams of strings

Where the source is already strings, such as an LLM token stream or another text transform, use `ReplaceContentTextTransformer`:

```typescript
import { ReplaceContentTextTransformer } from "replace-content-transformer/web";

const replaced = tokenStream.pipeThrough(
  new TransformStream(new ReplaceContentTextTransformer(engine))
);
```

`ReplaceContentTransformer` only reads UTF-8. For another encoding, decode first and use the text transformer:

```typescript
const replaced = readableStream
  .pipeThrough(new TextDecoderStream("shift_jis"))
  .pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine)));
```

`TextEncoderStream` only encodes UTF-8, so if the output becomes a `Response` body, change any `charset` in its `Content-Type` to `utf-8`.

> [!NOTE]
> With the regex search strategy, string chunks must not split a surrogate pair. A `TextDecoder` or `TextDecoderStream` never does. See [Surrogate pairs split across chunks](../src/search-strategies/regex/README.md#️-surrogate-pairs-split-across-chunks).

### Backpressure within a chunk

A `TransformStream` waits for its output to be read only before passing it the next chunk, so with `ReplaceContentTransformer` or `ReplaceContentTextTransformer`, every match in a chunk is replaced whether or not anything reads the output. Where replacements are expensive, such as sub-requests, or large, use `ReplaceContentStream` or `ReplaceContentTextStream` instead, a readable/writable pair that takes the same engine and is piped through the same way:

```typescript
import { ReplaceContentStream } from "replace-content-transformer/web";

const replaced = response.body!.pipeThrough(new ReplaceContentStream(engine));
return new Response(replaced, response);
```

Once 64 KiB of its output (65,536 code units for `ReplaceContentTextStream`) is waiting to be read, the engine calls no further replacement until no more than half of that is left unread. `SerialTransformEngine` waits at the next match, so at most one chunk's text and one replacement are buffered past that. `LookaheadTransformEngine` stops emitting, so its queue fills and it calls replacements only for the matches already queued: up to its concurrency limit, or up to its `highWaterMark` for `nested()` replacements, which give up their concurrency slot when they return. Each also waits between the pieces of an iterable replacement, such as a generator or a `fetch` body, though not of an array, whose pieces exist already. Unlike a `TransformStream`, the pair still cancels the engine when its output is cancelled after its input has ended.

Like a `TransformStream`, each pair takes a writable and a readable queuing strategy after the engine:

```typescript
const replaced = response.body!.pipeThrough(new ReplaceContentStream(engine, undefined, { highWaterMark: 0 }));
```

With a readable strategy of its own, the engine waits once that strategy's `highWaterMark` is reached, until no more than half of it is left unread. With `{ highWaterMark: 0 }`, as above, no chunk is passed to the engine, and no replacement called, while no read is waiting, so a consumer that cancels on seeing some output prevents every replacement after it. That costs throughput: `SerialTransformEngine` then enqueues its output before every replacement, rather than once per chunk. It does the same with a strategy whose `size()` counts neither chunks (a `CountQueuingStrategy`, or no `size()`) nor, for `ReplaceContentStream`, bytes (a `ByteLengthQueuingStrategy`).

Aborting the pair's writable side cancels the engine straight away, even while it waits for its output to be read, where the runtime has `WritableStreamDefaultController.signal` (see [Compatibility](./compatibility.md)). An abort that comes through `pipeTo()` or `pipeThrough()`, from their `signal` or from an error in the source, reaches the pair only once the chunk being written has finished, which it doesn't while nothing reads the output. To stop the engine then, cancel the pair's readable side too.

#### Encoding the output on older Node

On Node 22, Node 24 before 24.21.0 and Node 26 before 26.8.0, `TextEncoderStream` costs about 5–10 ms per MB, often more than the replacement itself ([nodejs/node#65414](https://github.com/nodejs/node/pull/65414)). Upgrade, or encode with a `TextEncoder` that, like `TextEncoderStream`, holds a trailing high surrogate back until the next chunk:

```typescript
function utf8EncoderStream() {
  const encoder = new TextEncoder();
  let pending = "";
  return new TransformStream<string, Uint8Array>({
    transform(chunk, controller) {
      const text = pending + chunk;
      const last = text.charCodeAt(text.length - 1);
      const splitsPair = last >= 0xd800 && last <= 0xdbff;
      pending = splitsPair ? text.slice(-1) : "";
      controller.enqueue(encoder.encode(splitsPair ? text.slice(0, -1) : text));
    },
    flush(controller) {
      if (pending) controller.enqueue(encoder.encode(pending));
    }
  });
}
```

Encoding each chunk on its own is not enough: an output chunk can end part-way through a surrogate pair, e.g. a match for `/a./` (no `u` flag) in `"a😀"` is `"a"` plus the first half of the emoji, and each half alone encodes to U+FFFD.

## Node streams

`ReplaceContentTransform` is a native [`stream.Transform`](https://nodejs.org/api/stream.html#class-streamtransform), avoiding the cost of [`toWeb`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options) / [`fromWeb`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options) conversion. Its `TransformOptions.highWaterMark` sets Node-stream backpressure independently of the engine's own `highWaterMark`. Once the readable side holds its `readableHighWaterMark` unread, the engine calls no further replacement until it is read, as with [`ReplaceContentStream`](#backpressure-within-a-chunk).

```typescript
// streaming esi:include middleware for express.js
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

> [!CAUTION]
> `Buffer` input is decoded as UTF-8, so other byte encodings are mis-decoded silently. Decode them upstream with a [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder) for the source charset (`decode(chunk, { stream: true })` per chunk) and write strings with `decodeStrings: false`. To re-encode the UTF-8 output to a legacy charset, use a library such as [`iconv-lite`](https://www.npmjs.com/package/iconv-lite).

A string written with Node's default `decodeStrings: true` becomes a `Buffer` in the encoding passed to `write()` (or `defaultEncoding`), then is decoded as UTF-8. With `decodeStrings: false`, strings reach the engine unchanged, a leading U+FEFF included.

## Encoding

- **Input bytes.** A multi-byte character split across chunks is decoded intact. A byte order mark at the start of the input is kept at the start of the output but not searched, so a search strategy and `streamIndices` see the text a `TextDecoder` would decode.
- **Replacement bytes.** A replacement can return or yield UTF-8 bytes (`Uint8Array`), so a `fetch` body can be returned as it is. The engine reads each replacement's bytes as one sequence: a character split across its chunks is kept whole, and an incomplete character or malformed byte becomes U+FFFD. A byte order mark at the start of a replacement's bytes, or of bytes that follow a string it yields, is dropped, as it would otherwise land mid-output.
- **Byte output.** `ReplaceContentTransformer` and `ReplaceContentTransform` (outside `readableObjectMode`) emit an async replacement's bytes without decoding and re-encoding them. Bytes returned synchronously, and everything sent to a string sink, are decoded, so the output text is the same with any adapter. Their byte output is always valid UTF-8, with a surrogate pair split across output chunks encoded as one character.
- **Copies.** The adapters copy the bytes they emit, so a replacement may reuse its buffer for its next chunk, and each chunk `ReplaceContentTransformer` emits has its own `ArrayBuffer`, which downstream may transfer.
