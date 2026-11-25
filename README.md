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

Replace patterns in streaming text as it flows, without buffering the whole stream or delaying output.

- 🎯 **Boundary-aware** - finds matches split across chunks, tested at every split of the input
- 🚀 **Streaming-first** - emits output as early as possible, holding back only what could still be part of a match
- 🎨 **Dynamic content** - replace with strings, functions, iterables or streams, sync or async
- 🔮 **Concurrent lookahead** - start later replacements while earlier ones are in flight, with output kept in order
- 🚦 **Backpressure-aware** - with the Node adapter or the web stream pairs, calls no further replacement while the output goes unread
- ⏹️ **Stoppable** - stop replacing at any match, and cancel replacements in flight
- 🔌 **Composable** - pluggable search strategies and engines; strategies are stateless and reusable
- 🌐 **Runs anywhere** - WHATWG Streams (browsers, Deno, Bun, edge workers, Node) and Node streams, with TypeScript types
- 🪶 **Low dependency** - lightweight and minimal [^1]

[^1]: a single peer dependency, enabling the regex search strategy

## 📦 Installation

```bash
npm install replace-content-transformer
```

[`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/) is a peer dependency, used by the regex search strategy. npm 7+, pnpm 8+, Bun and Deno install it automatically. Yarn doesn't, in either Classic (1.x) or Berry (2+), so add both:

```bash
yarn add replace-content-transformer regex-partial-match
```

Upgrading a major version? The [changelog](./docs/CHANGELOG.md) lists each breaking change, and [migration guides and codemods](./codemods/README.md) cover the upgrades that need them.

## 🚀 Quick start

```typescript
import {
  SerialTransformEngine,
  searchStrategyFactory
} from "replace-content-transformer";
import { ReplaceContentTransformer } from "replace-content-transformer/web";

// every "{{name}}" becomes "World"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory("{{name}}"),
    replacement: "World"
  })
);

const replaced = response.body!.pipeThrough(new TransformStream(transformer));
```

A transformer has three parts: a **search strategy** says what to match, an **engine** calls the replacement for each match, and an **adapter** runs the engine as a stream. Build a new engine and adapter for each stream; a search strategy can be shared.

The [recipes](./docs/recipes.md) go further: replacement functions, regular expressions, async and streamed content, concurrency and recursion.

### 1. What to match: a search strategy

| Strategy                                                                                  | Matches                                                                                       | `searchStrategyFactory(…)`                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`StringAnchorSearchStrategy`](./src/search-strategies/looped-indexOf-anchored/README.md) | A string, or a sequence of anchors in order, from the first to the last                       | `"{{x}}"`, `["{{", "}}"]`, `["[[", "\|", "]]"]` |
| [`BalancedPairSearchStrategy`](./src/search-strategies/balanced-pair/README.md)           | A delimiter pair, respecting nesting                                                          | —                                               |
| [`RegexSearchStrategy`](./src/search-strategies/regex/README.md)                          | A regular expression, [with limitations](./src/search-strategies/regex/README.md#limitations) | `/x+?/`                                         |
| [`LeanRegexSearchStrategy`](./src/search-strategies/regex/README.md#lean-bundles)         | The same, for a smaller bundle                                                                | —                                               |

`searchStrategyFactory` picks a strategy from its input. Constructing one directly gives a smaller bundle. Every strategy caps how much it holds back with `maxBufferLength`; see [Search strategies](./docs/search-strategies.md).

### 2. How to replace: an engine

| Engine                                                                           | Use when                                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`SerialTransformEngine`](./docs/engines.md#serialtransformengine)               | Replacements are synchronous, or should run one at a time            |
| [`LookaheadTransformEngine`](./src/engines/lookahead-transform-engine/README.md) | Replacements are I/O-bound, and later ones should start concurrently |

`replacement` is a string, or a function of the match and a context (`matchIndex`, `streamIndices`, and an abort `signal`) that returns a string, UTF-8 bytes, an iterable or async iterable of either (such as a `ReadableStream`), or a `Promise` of any of these. See [Engines](./docs/engines.md#serialtransformengine).

### 3. Where it runs: an adapter

| Adapter                                                                                              | Type                                        | Import                             | For                                                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| [`ReplaceContentTransformer`](./docs/adapters.md#whatwg-streams)                                     | `Transformer`, for `new TransformStream()`  | `replace-content-transformer/web`  | UTF-8 byte streams, such as a `fetch` body                 |
| [`ReplaceContentTextTransformer`](./docs/adapters.md#streams-of-strings)                             | `Transformer`, for `new TransformStream()`  | `replace-content-transformer/web`  | Streams of strings, or other encodings                     |
| [`ReplaceContentStream`, `ReplaceContentTextStream`](./docs/adapters.md#backpressure-within-a-chunk) | `ReadableWritablePair`, for `pipeThrough()` | `replace-content-transformer/web`  | As above, pausing replacements while the output isn't read |
| [`ReplaceContentTransform`](./docs/adapters.md#node-streams)                                         | `stream.Transform`                          | `replace-content-transformer/node` | Node streams, without web-stream conversion                |

## 📚 Documentation

- [Recipes](./docs/recipes.md) - examples by use case, from template placeholders to pages composed from fetched fragments
- [Adapters](./docs/adapters.md) - WHATWG and Node streams, and text encoding
- [Stopping and cancelling](./docs/cancellation.md) - `stopReplacingSignal`, the context `signal`, and stream cancellation
- [Search strategies](./docs/search-strategies.md) - choosing one, and the buffer limit
- [Engines](./docs/engines.md) - replacement forms
- [`LookaheadTransformEngine`](./src/engines/lookahead-transform-engine/README.md) - concurrency, backpressure, `nested()` recursion
- [Compatibility](./docs/compatibility.md) - runtimes and browsers

## 🌐 Compatibility

Node.js 22+, Bun 1.4+, Deno 1.38+, Chrome and Edge 85+, Firefox 102+, Safari 15+, and edge workers. `LookaheadTransformEngine` needs `AbortSignal.any()`. See [Compatibility](./docs/compatibility.md).

## 🤝 Contributing

Contributions are welcome! [Raise an issue](https://github.com/TomStrepsil/replace-content-transformer/issues) to report a bug, to ask for a change to a search strategy or engine, or to request a new one, or submit a pull request. See [Contributing](./docs/CONTRIBUTING.md).

## 📜 License

[ISC](./LICENSE) © Tom Pereira ([GitHub](https://github.com/TomStrepsil))

## 🔗 Related projects

- [regex-partial-match](https://github.com/TomStrepsil/regex-partial-match/) - companion project powering the regex search strategy
- [parse5-html-rewriting-stream](https://parse5.js.org/classes/parse5-html-rewriting-stream.RewritingStream.html) - a streaming [SAX](https://en.wikipedia.org/wiki/Simple_API_for_XML)-style HTML rewriter
- [stream-replace-string](https://github.com/ChocolateLoverRaj/stream-replace-string) - a Node stream transform (abandoned)
- [replacestream](https://github.com/eugeneware/replacestream) - a Node stream transform, supporting regex matching (last update 2016)
- [string-searching](https://github.com/string-searching) - various string searching algorithms in JavaScript
- [balanced-match](https://github.com/juliangruber/balanced-match/) - balanced string matching
