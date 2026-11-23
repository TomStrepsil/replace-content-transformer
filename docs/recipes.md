# Recipes

Each recipe builds on the [quick start](../README.md#-quick-start)'s static replacement, making a `transformer` to pipe through the same way, and assumes these imports:

```typescript
import {
  SerialTransformEngine,
  searchStrategyFactory
} from "replace-content-transformer";
import { ReplaceContentTransformer } from "replace-content-transformer/web";
```

| Recipe                                                                        | For example                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Anchor delimiters](#anchor-delimiters)                                       | Template placeholders, with or without a fallback                  |
| [Replacement functions](#replacement-functions)                               | Content computed from each match, or where it falls in the stream  |
| [Regular expressions](#regular-expressions)                                   | Rewriting markup in a proxy, or redacting quoted values            |
| [Balanced pairs](#balanced-pairs)                                             | Nested expressions                                                 |
| [Async replacement](#async-replacement)                                       | Inlining files, or values from a remote store, while rendering     |
| [Iterable replacement](#iterable-replacement)                                 | Expanding one token into several                                   |
| [Async iterable replacement](#async-iterable-replacement)                     | Streaming a fetched fragment into a page, as edge-side includes do |
| [Pipelined async replacement](#pipelined-async-replacement)                   | Composing a page from many fragments, fetched concurrently         |
| [Recursion](#recursion)                                                       | Fragments that include fragments                                   |
| [Limiting replacements](./cancellation.md#stop-replacing-stopreplacingsignal) | Replacing only the first few matches                               |

## Anchor delimiters

A sequence of anchors matches everything from the first to the last:

```typescript
// {{anything between braces}} replaced by "54321"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: "54321"
  })
);
```

Add anchors in between to match only where they all appear, in order:

```typescript
// "Hello [[name|friend]]" becomes "Hello Ada", or "Hello friend" when no name is stored
declare const values: Map<string, string>;

const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["[[", "|", "]]"]),
    replacement: (match) => {
      const [key, fallback] = match.slice(2, -2).split("|");
      return values.get(key) ?? fallback;
    }
  })
);
```

Anything may lie between two anchors, including the first anchor again: here, `[[a]] and [[b|c]]` is one match. Where what lies between matters, use a [regular expression](#regular-expressions).

## Replacement functions

A function receives the match and a context holding `matchIndex`, its ordinal in the stream:

```typescript
// "{{this}} and {{that}}" becomes "this was match 0 and that was match 1"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: (match, { matchIndex }) =>
      `${match.slice(2, -2)} was match ${matchIndex}`
  })
);
```

…and `streamIndices`, the match's character offsets from the start of the stream:

```typescript
// "here's {{this}}" becomes "here's this, found from 7 to 15"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: (match, { streamIndices: [start, end] }) =>
      `${match.slice(2, -2)}, found from ${start} to ${end}`
  })
);
```

> [!NOTE]
> `streamIndices[1]` (endIndex) is exclusive, following the same convention as [`String.prototype.slice(startIndex, endIndex)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice) [^1]

[^1]: See [half-open intervals](<https://en.wikipedia.org/wiki/Interval_(mathematics)#Half-open_intervals>)

## Regular expressions

A regex match carries its capture groups:

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

A backreference ties a later part of the match to an earlier capture, e.g. a string literal closed by whichever quote opened it:

```typescript
// `name = 'Alice'` becomes `name = 'REDACTED'`
// `code = `raw`` becomes `code = `REDACTED``
// `text = "it's fine"` becomes `text = "REDACTED"`: the apostrophe doesn't close a "-quoted string
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(/(['"`])(?:\\.|[^\\])*?\1/),
    replacement: (match) => `${match[1]}REDACTED${match[1]}`
  })
);
```

> [!CAUTION]
> The regex strategy is slower than string anchors, and does not support every regular expression feature. See its [limitations](../src/search-strategies/regex/README.md#limitations), including the streaming caveats for backreferences and positive lookaheads.

## Balanced pairs

`BalancedPairSearchStrategy` completes a match only once the outermost pair is balanced:

```typescript
import { BalancedPairSearchStrategy } from "replace-content-transformer";

// "(a (b) c)" becomes "[a (b) c]"
// "(d)" becomes "[d]"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: new BalancedPairSearchStrategy("(", ")"),
    replacement: (match) => `[${match.slice(1, -1)}]`
  })
);
```

It accepts two string anchors.

## Async replacement

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `<img src="file://image.png">` becomes `<img src="data:image/png;base64,...">`
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["<img", 'src="file://', '.png">']),
    replacement: async (imgTag) =>
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

Only an asynchronous result pauses the search, so a function can return synchronously for some matches, as with a cache:

```typescript
// "{{a}} {{b}} {{a}}" becomes the values of a and b, looking each up once
declare const remoteKeyValueStore: { get(key: string): Promise<string> };

const cache = new Map<string, string | Promise<string>>();
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory(["{{", "}}"]),
    replacement: (match): string | Promise<string> =>
      // a Promise the first time, which pauses the search
      cache.getOrInsertComputed(match, async (key) => {
        const value = await remoteKeyValueStore.get(key);
        cache.set(key, value); // later hits get the string, replaced straight away
        return value;
      })
  })
);
```

## Iterable replacement

Interpolate a sequence of strings, UTF-8 bytes (`Uint8Array`), or both:

```typescript
// "1 2 3 4 5" becomes "1 2 3.1 3.2 3.3 4 5"
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: searchStrategyFactory("3 "),
    replacement: () => [...Array(3)].map((_, i) => `3.${i + 1} `)
  })
);
```

## Async iterable replacement

Return an async iterable, such as a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) or an `async function*`, or a `Promise` of one. It can yield strings, bytes, or both, so a `fetch` body can be returned as it is (see [Encoding](./adapters.md#encoding)):

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

Passing the context's `signal` to `fetch` stops the request if the stream is cancelled. See [Stream cancellation](./cancellation.md#stream-cancellation-the-context-signal).

## Pipelined async replacement

`SerialTransformEngine` doesn't look for the next match until the current replacement has fully streamed out. For I/O-bound replacements, such as fragment fetches or [KV](https://en.wikipedia.org/wiki/Key%E2%80%93value_database) lookups, `LookaheadTransformEngine` starts later replacements while earlier ones are still in flight, keeping output in order:

```typescript
import {
  LookaheadTransformEngine,
  SemaphoreStrategy
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

See [`LookaheadTransformEngine`](../src/engines/lookahead-transform-engine/README.md) for concurrency strategies, backpressure, cancellation and recursion with `nested()`.

## Recursion

Replace within replacements, to a maximum depth:

```typescript
import type { TransformEngine } from "replace-content-transformer";

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
const transformer = new ReplaceContentTransformer(engineFor(0));
```

Each fragment is decoded once, by the transformer that searches it, and encoded once, in that transformer's output. The levels above pass its bytes through.

> [!CAUTION]
> `matchIndex` and `streamIndices` are relative to each engine's own input, not the whole stream.
