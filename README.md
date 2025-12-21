<p align="center">
  <h1 align="center">Replace Content Transformer</h1>
</p>
<p align="center">
A <a href="https://streams.spec.whatwg.org/#transformer-api">WHATWG Transformer</a> / Node <a href="https://nodejs.org/api/stream.html#class-streamtransform">stream.Transform</a> for replacing content.
</p>
<p align="center">
   <img src="https://github.com/TomStrepsil/replace-content-transformer/workflows/CodeQL/badge.svg" alt="Code QL security analysis status" />
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
- 🎨 **Dynamic content** - Replace with strings, functions, or iterables, sync or async
- ⏹️ **Cancellable** - Replacement can be halted mid-chunk
- ♻️ **Generator based** - Consuming stream has control
- ⚡ **Minimal setup overhead** - Stateless & re-usable search strategies
- 🔌 **Composable** - Pluggable search strategies & stream processors
- 📦 **TypeScript** - Full type definitions included

[^1]: a single peer dependency, enabling the regex search strategy

## 📦 Installation

```bash
npm install replace-content-transformer
```

## 🚀 Usage

See [Design](#-design) on composable parts to import and combine.

### WHATWG Transformer

Constructors are available from the `/web` import path, for both synchronous and asynchronous replacement use-cases:

```js
import {
  ReplaceContentTransformer,
  AsyncReplaceContentTransformer
} from "replace-content-transformer/web";
```

The constructors expect a "stream processor" and optional `AbortSignal` as arguments:

```ts
import type { SyncProcessor, AsyncProcessor } from "replace-content-transformer";
const syncTransformer = new ReplaceContentTransformer(
  processor: SyncProcessor, stopReplacingSignal?: AbortSignal
);
const asyncTransformer = new AsyncReplaceContentTransformer(
  processor: AsyncProcessor, stopReplacingSignal?: AbortSignal
);
```

The `SyncProcessor` and `AsyncProcessors` available are described in [Replacement Processors](#-replacement-processors).

These processors take `searchStrategy` (see [Search Strategies](#-search-strategies)) and `replacement` constructor options.

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
  StaticReplacementProcessor,
  searchStrategyFactory
} from "replace-content-transformer";
import { ReplaceContentTransformer } from "replace-content-transformer/web";

// {{needle}} replaced by "12345"
const transformer = new ReplaceContentTransformer(
  new StaticReplacementProcessor({
    searchStrategy: searchStrategyFactory("{{needle}}"),
    replacement: "12345"
  })
);
```

#### Replacing "Anchor" Delimiters (in sequence)

```typescript
// {{anything between braces}} replaced by "54321"
const transformer = new ReplaceContentTransformer(
  new StaticReplacementProcessor({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: "54321"
  })
);
```

#### Dynamic Replacement with Functions

Use a function for dynamic replacement, perhaps based on the original content:

```typescript
import { FunctionReplacementProcessor } from "replace-content-transformer";

// "{{this}} and {{that}}" becomes "this was match 0 and that was match 1"
const transformer = new ReplaceContentTransformer(
  new FunctionReplacementProcessor({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: (match: string, index: number) =>
      `${match.slice(2, -2)} was match ${index}`
  })
);
```

#### Replacing a Regular Expression

> [!NOTE]
> The `regex` search strategy is marginally less performant than static string anchors, and does not support all regular expression features. See [limitations](./src//search-strategies/regex/README.md#limitations).

```typescript
// Update deprecated CSS class names
const transformer = new ReplaceContentTransformer(
  new FunctionReplacementProcessor({
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

#### Async Replacement

Replace with asynchronous content. Ensures each async replacement completes before the next starts.

```typescript
import { AsyncFunctionReplacementProcessor } from "replace-content-transformer";

// `<a href="file://image.png" />` becomes "<a href="data:image/png;base64,... />"
const transformer = new AsyncReplaceContentTransformer(
  new AsyncFunctionReplacementProcessor({
    searchStrategy: searchStrategyFactory(["<a", 'href="file://', '.png" />']),
    replacement: async (anchorTag: string) =>
      `<a href="data:image/png;base64,${(
        await fs.readFile(anchorTag.match(/\/\/(.+?)"/)[1])
      ).toString("base64")}`
  })
);
```

Can alternatively use the non-async `FunctionReplacementProcessor` to process `Promise` responses, if using a `Promise<string>` generic-typed version, due to the WHATWG Streams API's native support for enqueueing any JavaScript value, including promises, which will be awaited by downstream consumers.

> [!WARNING]
> This subverts [back-pressure control](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Concepts#backpressure), and may conflict with a desired [highWaterMark](https://developer.mozilla.org/en-US/docs/Web/API/ByteLengthQueuingStrategy/highWaterMark); the replacement function
> can't slow down production based on consumer speed. However, it allows for early discovery in the input stream.

```typescript
const transformer = new ReplaceContentTransformer<Promise<string>>(
  new FunctionReplacementProcessor<Promise<string>>({
    searchStrategy: searchStrategyFactory(["<a", 'href="https://', '.png" />']),
    replacement: async (match: string): Promise<string> => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const res = await fetch(url);
      return await res.text();
    }
  })
);
```

> [!NOTE]
> If concurrency needs control, consider a replacement function that limits in-flight promises via promise-pooling:

```typescript
const maxConcurrent = 5;
const active = new Set();
const replacement = async (match) => {
  if (active.size >= maxConcurrent) {
    await Promise.race(active);
  }
  const [, url] = /href="([^"]+)"/.exec(match)!;
  const promise = fetch(url).then((resolved) => {
    active.delete(promise);
    return resolved;
  });
  active.add(promise);
  return promise;
};
```

#### Iterable Replacement

Interpolate a sequence into the stream:

```typescript
import { IterableFunctionReplacementProcessor } from "replace-content-transformer";

// "1 2 3 4 5" becomes "1 2 3.1 3.2 3.3 4 5"
const transformer = new ReplaceContentTransformer(
  new IterableFunctionReplacementProcessor({
    searchStrategy: searchStrategyFactory("3 "),
    replacement: () => [...Array(3)].map((_, i) => `3.${i + 1} `)
  })
);
```

#### Async Iterable Replacement

Interpolate [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)s, or other async iterables, into the output. Ensures each async operation completes before the next starts:

```typescript
import { AsyncIterableFunctionReplacementProcessor } from "replace-content-transformer";

// `<div><esi:include src="https://example.com/foo" /></div>` fills the <div> with content fetched from https://example.com/foo
const transformer = new AsyncReplaceContentTransformer(
  new AsyncIterableFunctionReplacementProcessor({
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
```

#### Manage Recursion

Recursive replacement, with controlled depth:

```typescript
const searchStrategy = searchStrategyFactory(["<esi:include", "/>"]);
const maxDepth = 3;
function transformerFactory(currentDepth: number) {
  return new AsyncReplaceContentTransformer(
    new AsyncIterableFunctionReplacementProcessor({
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

#### Limit replacements

To abort replacement after a certain number of replacements (or, for any other reason), provide an [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal):

```ts
const abortController = new AbortController();
const transformer = new AsyncReplaceContentTransformer(
  new AsyncIterableFunctionReplacementProcessor({
    searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
    replacement: async (match, index) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const response = await fetch(url);
      if (response.ok) {
        return response.body.pipeThrough(new TextDecoderStream());
      }
      if (index === 1) {
        abortController.abort(); // after two replacements, stop replacing
      }
    }
  }),
  abortController.signal
);
```

This will ensure the transform is ["pass through"](https://en.wikipedia.org/wiki/Identity_transform) once the abort is signalled.

For cancellation external to the replacement function, can consider sharing the abort signal with `fetch`:

```ts
const abortController = new AbortController();
const transformer = new AsyncReplaceContentTransformer(
  new AsyncIterableFunctionReplacementProcessor({
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
          // needs to be an async iterable to satisfy the AsyncIterableFunctionReplacementProcessor.
          // awaiting AsyncIterator.from(["<!-- cancelled -->"]) in proposal: https://github.com/tc39/proposal-async-iterator-helpers
          return (async function* () {
            yield "<!-- cancelled -->";
          })();
        }
        throw error;
      }
    }
  }),
  abortController.signal
);
someEventBus.once("someEvent", () => abortController.abort());
```

This should ensure in-flight requests are cancelled along with ongoing replacement.

### Node Transform

Use the Node adapters (`ReplaceContentTransform` / `AsyncReplaceContentTransform`) for a native [`stream.Transform`](https://nodejs.org/api/stream.html#class-streamtransform) implementation, if performance cost of [`toWeb`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options) / [`fromWeb`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options) conversion is a concern.

```typescript
// streaming esi middleware for express.js, using native NodeJs stream.Transform
import { responseHandler } from "express-intercept";
import { AsyncReplaceContentTransform } from "replace-content-transformer/node";
import type { Readable } from "node:stream";
import { get } from "node:https";

const searchStrategy = searchStrategyFactory(["<esi:include", "/>"]);
const maxDepth = 3;
function transformFactory(currentDepth: number) {
  return new AsyncReplaceContentTransform(
    new AsyncIterableFunctionReplacementProcessor({
      searchStrategy,
      replacement: async (match: string) => {
        const {
          groups: { url }
        } = /src="(?<url>[^"]+)"/.exec(match)!;
        const nodeStream = await new Promise<Readable>((resolve, reject) => {
          get(url, (res) => resolve(res)).on("error", reject);
        });
        return currentDepth < maxDepth
          ? nodeStream.pipe(transformFactory(currentDepth + 1))
          : nodeStream;
      }
    })
  );
}
const expressMiddleware = responseHandler()
  .if((res) => /html/i.test(res.getHeader("content-type")))
  .interceptStream((upstream: Readable, _, res) => {
    res.removeHeader("content-length");
    return upstream.pipe(transformFactory(0));
  });
```

## 🧬 Design

The library uses a composable architecture that finds and replaces patterns across chunk boundaries.

It has separated concerns:

1. **[Search Strategies](#-search-strategies)** - Define _what_ to match (e.g., literal strings, arrays of strings as anchors, regular expressions)
2. **[Replacement Processors](#-replacement-processors)** - Enact strategies using replacement logic and yield output via generators

### 🔍 Search Strategies

Pluggable strategies implement the `SearchStrategy` interface:

```typescript
interface MatchResult {
  content: string;
  match: boolean;
}
interface SearchStrategy<TState> {
  createState(): TState;
  processChunk(
    haystack: string,
    state: TState
  ): Generator<MatchResult, void, undefined>;
  flush(state: TState): string;
}
```

The `TState` type is specific to the strategy, managed by the consuming processor / stream, to keep the strategies stateless. This means any construction cost can be reduced, with strategies re-used across multiple streams.

The `flush` is called by the processor to extract anything buffered from the search strategy. This also re-sets the provided state parameter for re-use.

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

..or

```ts
const searchStrategy = new StringAnchorSearchStrategy(["{{", "}}"]); // 2+ "anchor" delimiters/tokens
```

or

```ts
import { RegexSearchStrategy } from "replace-content-transformer";
const searchStrategy = new RegexSearchStrategy(/<div>.+?<\/div>/s); // regular expression for complete match
```

### 🦾 Replacement Processors

Processors accept chunks from the `Transformer` (web) / `stream.Transform` (node), and orchestrate replacement, using a search strategy.

```typescript
// sync or async, dependent on asynchronicity of the replacement needed
*processChunk(chunk: string): Generator<string, void, undefined> {
  for (const result of this.searchStrategy.processChunk(
    chunk,
    this.searchState
  )) {
    yield result.match ? /* some replacement form (static, functional, iterator, async...) */ : result.content;
  }
}
// common to all processors
flush(): string {
  return this.searchStrategy.flush(this.searchState);
}
```

**Why so many options?**

There are 5 stream processors to select from, rather than the system figuring out the optimum based on supplied options. See [Replacement Processors](./src/replacement-processors/README.md) for detailed usage guidance.

- **`StaticReplacementProcessor`** - Yields static strings
- **`FunctionReplacementProcessor`** - Yields function results, passing the match and a match index / sequence number
- **`IterableFunctionReplacementProcessor`** - Allows a function to return an iterable, flattened with [`yield*`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/yield*)
- **`AsyncFunctionReplacementProcessor`** - Allows an async function, as an async generators with [`for await`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of)
- **`AsyncIterableFunctionReplacementProcessor`** - Flattens async iterables with `yield* await` (assumption that async iterator is itself accessed via a Promise)

There is no reliable way in javascript to detect the output type of a function without calling it, and trying to adapt just-in-time based on the first replacement made would be complex. The type of function can be thought to have a ["colour"](https://journal.stuffwithstuff.com/2015/02/01/what-color-is-your-function/#what-color-is-your-function) that requires up-front selection.

Rather than a one-size-fits-all / common-denominator supporting asynchronicity (whether needed or not) or adapting to varying function output, the design accepts that a slight (but potentially significant) performance overhead exists with asynchronicity (in Node, at least) [^2]

Forcing all consumers to act asynchronously, or creating arbitrary iterator adapters above a simple static replacement, was deemed more unwieldy than the choice to be made.

The project aimed for a lightweight code footprint, so providing many options (with unused variation tree-shaken out) is a means to optimise.

[^2]: N.B. A similar performance overhead exists by virtue of the generator pattern used, but this is accepted for the just-in-time nature flexibility afforded.

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
- **Replacement Processors** - Static, function-based, iterable, and async replacement logic
- **Adapters** - WHATWG Transformer and Node.js stream.Transform implementations
- **Factory Functions** - Strategy factory and helper utilities

### Integration Tests

- **Cross-component** - Processors combined with search strategies
- **Streaming scenarios** - Transformers with processors in stream pipelines
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

## 🌐 Browser Compatibility

This library uses the [WHATWG Streams API](https://streams.spec.whatwg.org/) and is compatible with multiple JavaScript runtimes:

### ✅ Fully Supported Runtimes

- **Node.js** 18.0.0+
- **Bun** 1.0+
- **Deno** 1.17+
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

Available runtimes are continuously tested in CI.

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
