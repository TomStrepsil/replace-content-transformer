# Search strategies

A search strategy defines _what_ to match. Strategies are stateless: the engine holds each stream's state, so one strategy can be built once and reused across streams.

| Strategy                                                                                       | Matches                                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`StringAnchorSearchStrategy`](../src/search-strategies/looped-indexOf-anchored/README.md)     | A string, or a sequence of "anchor" strings from the first to the last    |
| [`BalancedPairSearchStrategy`](../src/search-strategies/balanced-pair/README.md)               | A delimiter pair, respecting nesting, e.g. `(outer (inner) rest)`         |
| [`RegexSearchStrategy`](../src/search-strategies/regex/README.md)                              | A regular expression, [with some limitations](../src/search-strategies/regex/README.md#limitations) |
| [`LeanRegexSearchStrategy`](../src/search-strategies/regex/README.md#lean-bundles)             | The same, from a `PartialMatchRegExp` built with `regex-partial-match/core`, for a smaller bundle |

Prefer string anchors where they suffice: they are faster than the regex strategy. See [Search Strategies](../src/search-strategies/README.md) for how each works and performs.

Need a strategy that isn't here, or a change to one? [Raise an issue](https://github.com/TomStrepsil/replace-content-transformer/issues).

## Regex matches

The regex strategies pass a replacement a `StreamRegexMatch`: a `RegExpExecArray` with its capture groups, whose `index` and `indices` are offsets into the stream. Its `input` is `undefined`, since a native `input` would hold one scan buffer rather than the stream.

## Choosing a strategy

`searchStrategyFactory` builds a strategy from its input:

```ts
import { searchStrategyFactory } from "replace-content-transformer";
searchStrategyFactory(input: RegExp, options?: RegexSearchStrategyOptions): RegexSearchStrategy;
searchStrategyFactory(input: string | string[], options?: BufferGuardOptions): StringAnchorSearchStrategy;
```

The `options` are [`maxBufferLength` and `onGuardExceeded`](#buffer-limit). Given a `RegExp`, they may also include `minCandidateLengthToBackOff` and `bufferGrowthFactorBetweenEvaluations` (see [Unbounded Quantifiers](../src/search-strategies/regex/README.md#️-unbounded-quantifiers)). An input typed only as `string | string[] | RegExp` takes `BufferGuardOptions`, and returns either strategy. The factory never returns a `BalancedPairSearchStrategy`, which can't be told from the input.

Constructing a strategy directly gives a smaller bundle when its kind is known at design time:

```ts
import {
  StringAnchorSearchStrategy,
  BalancedPairSearchStrategy,
  RegexSearchStrategy,
  LeanRegexSearchStrategy
} from "replace-content-transformer";
import PartialMatchRegExp from "regex-partial-match/core";

new StringAnchorSearchStrategy(["<!--replace me -->"]); // single token
new StringAnchorSearchStrategy(["[[", "|", "]]"]); // 2+ anchors
new BalancedPairSearchStrategy("{{", "}}"); // delimiter pair, nesting aware
new RegexSearchStrategy(/<([^>]+?)>.+?<\/\1>/s); // full regex support (with caveats)
new LeanRegexSearchStrategy(new PartialMatchRegExp(/<div>.+?<\/div>/s)); // lean bundle: add regex-partial-match modules for the features a pattern needs
```

Anchors and delimiters must be non-empty: an empty string is rejected at construction, since `indexOf("")` would never advance the scan.

## Buffer limit

A match can span chunks, so a strategy holds back content that could still become part of one. Every strategy, and `searchStrategyFactory`, caps this with `maxBufferLength`, in UTF-16 code units (65,536 by default). A match still incomplete that far from its start has `onGuardExceeded` called, then passes through as text up to there, and the search restarts right after. Output stays lossless, and doesn't depend on how the input is split. `Infinity` removes the cap. For the string strategies, a limit shorter than the anchors together throws a `RangeError`, since nothing could match.

```ts
new StringAnchorSearchStrategy(["<esi:include", "/>"], {
  maxBufferLength: 16 * 1024,
  onGuardExceeded: () =>
    console.warn("an <esi:include> passed through unreplaced")
});
```

### What `onGuardExceeded` can do

`onGuardExceeded` is called synchronously, before the text it releases is emitted, from the search that takes a held match past the limit. That search usually runs in a `write()`, but can also run as the stream closes or, for [`nested()`](../src/engines/lookahead-transform-engine/README.md#recursive-replacement) content, as output drains. The callback can:

- **Notify**, as above: the match passes through as text, and replacing carries on.
- **Stop replacing:** abort the engine's [`stopReplacingSignal`](./cancellation.md#stop-replacing-stopreplacingsignal). The released text, and the rest of the stream, pass through verbatim, except that `LookaheadTransformEngine` still runs a replacement it has already called, such as one for an outer match found after the `nested()` content in which the limit was crossed. It also passes through an earlier match whose replacement it hasn't called yet, even one in the same `write()`, [as for any abort](../src/engines/lookahead-transform-engine/README.md#stopping-new-replacements-stopreplacingsignal). The callback may run again later in the same chunk, so make it safe to repeat.

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
