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
- 🔄 **Multiple replacements** - Supports replacing multiple occurrences
- 🔮 **Eager discovery** - Supporting lookahead replacement, with configurable concurrency
- 🎨 **Dynamic content** - Replace with strings, functions, or iterables, sync or async
- ⏹️ **Cancellable** - Replacement can be halted mid-chunk
- ♻️ **Generator based** - Consuming stream has control
- ⚡ **Minimal setup overhead** - Stateless & re-usable search strategies
- 🔌 **Composable** - Pluggable search strategies & engines
- 📦 **TypeScript** - Full type definitions included

[^1]: a single peer dependency, enabling the regex search strategy

## 📦 Installation

```bash
npm install replace-content-transformer
```

## 🚀 Usage

See [Design](#-design) on composable parts to import and combine.

### WHATWG Transformers

Constructors are available from the `/web` import path, for both synchronous and asynchronous replacement use-cases:

```js
import {
  ReplaceContentTransformer,
  AsyncReplaceContentTransformer
} from "replace-content-transformer/web";
```

The constructors each accept an engine (see [Engines](#-engines)):

```ts
const syncTransformer = new ReplaceContentTransformer(engine: SyncTransformEngine);
const asyncTransformer = new AsyncReplaceContentTransformer(engine: AsyncTransformEngine);
```

The transformer acts on decoded text streams, and should be plugged into a stream pipeline appropriately. e.g.

```typescript
const replacedStream = readableStream
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new TransformStream(transformer))
  .pipeThrough(new TextEncoderStream());
```

### 👨‍🍳 Recipes

#### Single Static String Replacement

```typescript
import {
  SyncReplacementTransformEngine,
  searchStrategyFactory
} from "replace-content-transformer";
import { ReplaceContentTransformer } from "replace-content-transformer/web";

// {{needle}} replaced by "12345"
const transformer = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({
    searchStrategy: searchStrategyFactory("{{needle}}"),
    replacement: "12345"
  })
);
```

#### Replacing "Anchor" Delimiters (in sequence)

```typescript
// {{anything between braces}} replaced by "54321"
const transformer = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: "54321"
  })
);
```

#### Dynamic Replacement with Functions

Use a function for dynamic replacement, perhaps based on the original content:

```typescript
import { SyncReplacementTransformEngine } from "replace-content-transformer";

// "{{this}} and {{that}}" becomes "this was match 0 and that was match 1"
const transformer = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: (
      match: string,
      { matchIndex }: { matchIndex: number }
    ) =>
      `${match.slice(2, -2)} was match ${matchIndex}`
  })
);
```

Access the character indices of the match, relative to the start of the stream:
```typescript
// "here's {{this}}" becomes "here's this, found from 7 to 15"
const transformer = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({
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
> `streamIndices[1]` (endIndex) is exclusive, following the same convention as [`String.prototype.slice(startIndex, endIndex)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice)[^2]

[^2]: See [half-open intervals](https://en.wikipedia.org/wiki/Interval_(mathematics)#Half-open_intervals)

#### Replacing a Regular Expression

```typescript
// `class="anything old-button"` becomes `class="anything new-button"`
// `class="old-button something else"` becomes `class="new-button something else"`
// `class="cold-button"` remains `class="cold-button"`
const transformer = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({
    searchStrategy: searchStrategyFactory(
      /class="(?<before>[^"]*?\b)old-button(?<after>\b[^"]*?)"/
    ),
    replacement: (match: RegExpExecArray) => {
      const { before, after } = match.groups;
      return `class="${before}new-button${after}"`;
    }
  })
);
```

> [!CAUTION]
> The `regex` search strategy is marginally less performant than static string anchors, and does not support all regular expression features. See [limitations](./src/search-strategies/regex/README.md#limitations).

#### Async Replacement

Replace with asynchronous content. Ensures each async replacement completes before the next starts.

```typescript
import { AsyncSerialReplacementTransformEngine } from "replace-content-transformer";
import { AsyncReplaceContentTransformer } from "replace-content-transformer/web";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `<img src="file://image.png">` becomes "<img src="data:image/png;base64,...>"
const transformer = new AsyncReplaceContentTransformer(
  new AsyncSerialReplacementTransformEngine({
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

> [!TIP] 
> For **pipelined** async replacement — where later matches should be discovered and their async work started while earlier replacements are still in flight, without sacrificing in-order output or letting concurrency run away — use [`AsyncLookaheadTransformEngine`](#-pipelined-async-replacement-with-asynclookaheadtransformengine) (see below).

#### Iterable Replacement

Interpolate a sequence into the stream:

```typescript
// "1 2 3 4 5" becomes "1 2 3.1 3.2 3.3 4 5"
const transformer = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({
    searchStrategy: searchStrategyFactory("3 "),
    replacement: () => [...Array(3)].map((_, i) => `3.${i + 1} `)
  })
);
```

#### Async Iterable Replacement

Interpolate [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)s, or other async iterables, into the output. Ensures each async operation completes before the next starts:

You can return either form:

- an async iterable directly (for example `async function*`)
- a `Promise<AsyncIterable<string>>` (for example an `async` function returning a stream)

```typescript
// `<div><esi:include src="https://example.com/foo" /></div>` fills the `<div>` with content fetched from https://example.com/foo
const transformer = new AsyncReplaceContentTransformer(
  new AsyncSerialReplacementTransformEngine({
    searchStrategy: searchStrategyFactory(["<esi:include", "/>"]),
    replacement: async (match: string) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const res = await fetch(url);
      return res.body!.pipeThrough(new TextDecoderStream());
    }
  })
);

// direct async iterable form
const transformerWithGenerator = new AsyncReplaceContentTransformer(
  new AsyncSerialReplacementTransformEngine({
    searchStrategy: searchStrategyFactory("{{needle}}"),
    replacement: async function* () {
      yield "first chunk";
      yield "second chunk";
    }
  })
);
```

#### Pipelined Async Replacement with `AsyncLookaheadTransformEngine`

For I/O-bound replacements (fragment fetches, KV lookups, etc.) the `AsyncSerialReplacementTransformEngine` above processes matches **serially** — the next match isn't even looked for until the current replacement has fully streamed to the output. That means later matches wait idle while earlier replacements are still in flight, even if they could be running concurrently.

`AsyncLookaheadTransformEngine` scans ahead and **initiates** later matches' replacement work while earlier ones are still in flight, preserving in-order output. A pluggable `ConcurrencyStrategy` controls when and in what order work is dispatched (including explicit unfettered dispatch via `new SemaphoreStrategy(Infinity)`), and replacements can opt in to recursive re-scanning via the `nested()` sentinel.

```typescript
import {
  AsyncLookaheadTransformEngine,
  SemaphoreStrategy,
  searchStrategyFactory
} from "replace-content-transformer";

const transformer = new AsyncReplaceContentTransformer(
  new AsyncLookaheadTransformEngine({
    searchStrategy: searchStrategyFactory(["<esi:include", "/>"]),
    concurrencyStrategy: new SemaphoreStrategy(8),
    replacement: async (match) => {
      const { groups: { url } } = /src="(?<url>[^"]+)"/.exec(match)!;
      const res = await fetch(url);
      return res.body!.pipeThrough(new TextDecoderStream());
    }
  })
);
```

See the [full documentation](./src/engines/async-lookahead-transform-engine/README.md) for usage examples, concurrency strategies, backpressure/`highWaterMark`, cancellation, and recursive composition.

#### Manage Recursion

Recursive replacement, with controlled depth:

```typescript
const searchStrategy = searchStrategyFactory(["<esi:include", "/>"]);
const maxDepth = 3;
function transformerFactory(currentDepth: number) {
  return new AsyncReplaceContentTransformer(
    new AsyncSerialReplacementTransformEngine({
      searchStrategy,
      replacement: async (match: string) => {
        const {
          groups: { url }
        } = /src="(?<url>[^"]+)"/.exec(match)!;
        const res = await fetch(url);
        const bodyStream = res.body!.pipeThrough(new TextDecoderStream());
        return currentDepth < maxDepth
          ? bodyStream.pipeThrough(
              new TransformStream(transformerFactory(currentDepth + 1))
            )
          : bodyStream;
      }
    })
  );
}
// replaces esi include tags, recursively in fetched content, to a max depth of 3
const transformer = transformerFactory(0);
```

> [!NOTE]
> When using `matchIndex` / `streamIndices` from context, these will be specific to each engine instance, thus may not be the holistic "indexes into the stream".

#### Limit replacements

To abort replacement after a certain number of replacements (or, for any other reason), provide an [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) via the engine's `stopReplacingSignal` option:

```ts
const abortController = new AbortController();
const transformer = new AsyncReplaceContentTransformer(
  new AsyncSerialReplacementTransformEngine({
    searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
    replacement: async (match, { matchIndex }) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const response = await fetch(url);
      if (response.ok) {
        return response.body!.pipeThrough(new TextDecoderStream());
      }
      if (matchIndex === 1) {
        abortController.abort(); // after two replacements, stop replacing
      }
    },
    stopReplacingSignal: abortController.signal
  })
);
```

This will ensure the transform is ["pass through"](https://en.wikipedia.org/wiki/Identity_transform) once the abort is signalled.

For `fetch` uses cases, with cancellation external to the replacement function, consider sharing the abort signal:

```ts
const abortController = new AbortController();
const transformer = new AsyncReplaceContentTransformer(
  new AsyncSerialReplacementTransformEngine({
    searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
    replacement: async (match) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      try {
        const response = await fetch(url, { signal: abortController.signal });
        if (response.ok) {
          return response.body!.pipeThrough(new TextDecoderStream());
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          // needs to be an async iterable to satisfy AsyncSerialReplacementTransformEngine. (Awaiting AsyncIterator.from(["<!-- cancelled -->"]) in proposal: https://github.com/tc39/proposal-async-iterator-helpers)
          return (async function* () {
            yield "<!-- cancelled -->";
          })();
        }
        throw error;
      }
    },
    stopReplacingSignal: abortController.signal
  })
);
someEventBus.once("someEvent", () => abortController.abort());
```

This should ensure in-flight requests are cancelled along with ongoing replacement.

### Node Transform

Use the Node adapters (`ReplaceContentTransform`, `AsyncReplaceContentTransform`) for a native [`stream.Transform`](https://nodejs.org/api/stream.html#class-streamtransform) implementation, if performance cost of [`toWeb`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options) / [`fromWeb`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options) conversion is a concern.

> **Encoding**: these adapters assume UTF-8 input. Node's default `decodeStrings: true` behaviour re-encodes any string written to the writable side as a UTF-8 `Buffer`; non-UTF-8 byte streams will be mis-decoded silently.

`AsyncReplaceContentTransform` accepts any `AsyncTransformEngine`, including `AsyncLookaheadTransformEngine`. It shares the same engine and options as its web counterpart, so pipelined in-order async replacement, nested `nested()` re-scanning, bounded concurrency, and `highWaterMark` backpressure behave identically across runtimes. The standard `TransformOptions.highWaterMark` controls Node-stream backpressure independently of the engine's own `highWaterMark`.

```typescript
// streaming esi middleware for express.js, using native Node.js stream.Transform
import { responseHandler } from "express-intercept";
import { AsyncReplaceContentTransform } from "replace-content-transformer/node";
import {
  AsyncLookaheadTransformEngine,
  SemaphoreStrategy,
  searchStrategyFactory,
  nested
} from "replace-content-transformer";
import type { Readable } from "node:stream";
import { get } from "node:https";

const searchStrategy = searchStrategyFactory(["<esi:include", "/>"]);
const maxDepth = 3;
function transformFactory() {
  return new AsyncReplaceContentTransform(
    new AsyncLookaheadTransformEngine({
      searchStrategy,
      concurrencyStrategy: new SemaphoreStrategy(8),
      replacement: async (match, { depth }) => {
        const {
          groups: { url }
        } = /src="(?<url>[^"]+)"/.exec(match)!;
        const nodeStream = await new Promise<Readable>((resolve, reject) => {
          get(url, (res) => {
            res.setEncoding("utf8");
            resolve(res);
          }).on("error", reject);
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

## 🧬 Design

The library uses a composable architecture that finds and replaces patterns across chunk boundaries.

It has separated concerns:

1. **[Search Strategies](#-search-strategies)** - Define _what_ to match (e.g., literal strings, arrays of strings as anchors, regular expressions)
2. **[Engines](#-engines)** - Orchestrate search and replacement, yielding output via generators

### 🔍 Search Strategies

Pluggable strategies implement the `SearchStrategy` interface:

```typescript
type MatchResult<T = string> =
  | { isMatch: false; content: string }
  | { isMatch: true; content: T, streamIndices: [startIndex: number, endIndex: number]};

interface SearchStrategy<TState, TMatch = string> {
  createState(): TState;
  processChunk(
    haystack: string,
    state: TState
  ): Generator<MatchResult<TMatch>, void, undefined>;
  flush(state: TState): string;
}
```

The `TState` type is specific to the strategy, managed by the consuming engine / stream, to keep the strategies stateless. This means any construction cost can be reduced, with strategies re-used across multiple streams.

The `TMatch` type (defaulting to `string`) allows strategies like `RegexSearchStrategy` to return richer match data (e.g., `RegExpExecArray`) that includes capture groups.

The `flush` is called by the engine to extract anything buffered from the search strategy. This also re-sets the provided state parameter for re-use.

> [!NOTE]
> The `streamIndices` property contains absolute character offsets into the stream passed to the engine as `[startIndex, endIndex]`, thus not chunk-relative.

Each strategy contains the pattern-matching logic for a specific use case:

- **[`StringAnchorSearchStrategy`](./src/search-strategies/looped-indexOf-anchored/README.md)** - finds either single tokens, or "anchor" tokens delimiting start/end (or in sequence in-between) of a match
- **[`RegexSearchStrategy`](./src/search-strategies/regex/README.md)** - Matches against regular expressions (with some caveats)

See [search strategies](./src/search-strategies/README.md) for detail of functionality, and development of the strategies.

### 🏭 Search Strategy Factory

If tree-shaking is not a concern, a factory method for generating a search strategy based on appropriate input is available:

```ts
import { searchStrategyFactory } from "replace-content-transformer";
const searchStrategy =
  searchStrategyFactory(input: string | string[] | RegExp);
```

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
import { RegexSearchStrategy } from "replace-content-transformer";
const searchStrategy = new RegexSearchStrategy(/<div>.+?<\/div>/s); // regular expression for complete match
```

### 🦾 Engines

Engines process chunks from the `Transformer` (web) / `stream.Transform` (node), orchestrating replacement using a search strategy. They implement one of two interfaces:

```typescript
interface SyncTransformEngine {
  start(sink: EngineSink): void;
  write(chunk: string): void;
  end(): void;
}

interface AsyncTransformEngine {
  start(sink: EngineSink): void;
  write(chunk: string): Promise<void>;
  end(): void | Promise<void>;
  cancel?(): void;
}
```

There are three concrete engines:

- **`SyncReplacementTransformEngine`** — synchronous replacement. `replacement` can be a plain `string` for static replacement, or a function returning `string | Iterable<string>` for functional and iterable use-cases

- **`AsyncSerialReplacementTransformEngine`** — asynchronous serial replacement. Each match is fully consumed before the engine scans for the next. `replacement` returns `string | AsyncIterable<string> | Promise<string | AsyncIterable<string>>`

- **`AsyncLookaheadTransformEngine`** — concurrent pipelined replacement. Scans ahead and initiates replacement work for later matches while earlier ones are still in flight, preserving in-order output. Uses a pluggable `ConcurrencyStrategy` and supports recursive re-scanning via the `nested()` sentinel. See the [full documentation](./src/engines/async-lookahead-transform-engine/README.md)

The sync/async distinction determines which adapter accepts the engine (`ReplaceContentTransformer` / `AsyncReplaceContentTransformer`).

```typescript
// sync or async, dependent on asynchronicity of the replacement needed
*processChunk(chunk: string): Generator<string, void, undefined> {
  for (const { isMatch, content } of this.searchStrategy.processChunk(
    chunk,
    this.searchState
  )) {
    if (isMatch) {
      yield /* some replacement form (static, functional, iterator, async...) */
    } else {
      yield content;
    }
  }
}
// common to all engines
flush(): string {
  return this.searchStrategy.flush(this.searchState);
}
```

**Why generators?**

- **Lazy evaluation** - Output is produced only when deemed consumable
- **Memory efficient** - No need to accumulate entire result
- **[Backpressure](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Concepts#backpressure) support** - Downstream can control the flow rate
- **Cancellable** - Consumer can abort matching mid-chunk
- **Composition** - Easily chain with iterables, async iterables, or streams

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
- **Engines** - Sync, async serial, and lookahead replacement logic
- **Adapters** - WHATWG Transformer and Node.js stream.Transform implementations
- **Factory Functions** - Strategy factory and helper utilities

### Integration Tests

- **Cross-component** - Engines combined with search strategies
- **Streaming scenarios** - Transformers with engines in stream pipelines
- **Promise handling** - Async replacement functions and promise-based workflows
- **Abort signals** - Cancellation and signal propagation

### Functional Validation Tests

- **Algorithm comparison** - 14 different search strategy implementations validated against identical test scenarios:
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

- **Node.js** 22.0.0+
- **Bun** 1.0+
- **Deno** 1.38+
- **Browsers:**
  - Chrome 52+
  - Firefox 65+
  - Safari 14.1+
  - Edge 79+
- **Edge Workers:**
  - Cloudflare Workers
  - Vercel Edge Functions
  - Akamai EdgeWorkers
  - Fastly Compute

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
