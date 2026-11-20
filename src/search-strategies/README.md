# Search Strategies

This directory contains search strategies for finding and matching patterns in streaming content. Each strategy handles patterns that may span chunk boundaries.

These strategies have been chosen from an array of alternatives (see [benchmarking](#benchmark-strategies)). The "string anchor" is 1.3–2.7x faster than the regex strategy on the same patterns in the algorithm benchmarks, and about 30x with 16 KB chunks and no matches, so should be preferred unless more complex matching is required. See [why it uses smart buffering](./looped-indexOf-anchored/README.md#why-smart-buffering).

## 🪝 String Anchor (N-Token Sequential Matching)

**[looped-indexOf-anchored](./looped-indexOf-anchored/README.md)** - Exported as `StringAnchorSearchStrategy`

Single or Multiple-token sequential matching using smart buffering (only when the tail of a chunk might be the prefix of a match). Uses native `indexOf` for fast exact string matching. Ideal for matching patterns like `{replace me}`, `[START]...[END]` or more complex multi-delimiter sequences.

- **Algorithm**: Selective buffering with sequential token matching
- **Performance**: O(n+m), very fast due to native `indexOf` optimizations
- **Use Case**: Single or Sequential multi-delimiter patterns in streaming content
- **Exported As**: `StringAnchorSearchStrategy`

## ⚖️ Balanced Pair (Nesting-Aware Matching)

**[balanced-pair](./balanced-pair/README.md)** - Nesting-aware delimiter matching strategy implementation

Matches opening/closing delimiters where nesting is meaningful: the match only completes once every inner opening has a corresponding closing. Built on top of `StringAnchorSearchStrategy`, adding a nesting-level counter that keeps the match open until the outermost pair is balanced.

- **Algorithm**: Nesting-level tracking over sequential anchor matching
- **Performance**: O(n+m) for scanning + O(k) per match increment to count inner openings (k = length of new match content)
- **Use Case**: Balanced/nested structures — parentheses, braces, custom multi-character delimiters
- **Exported As**: `BalancedPairSearchStrategy`

## 🧠 Regex

**[regex](./regex/README.md)** - Pattern matching using regular expressions

[Regular expression](https://en.wikipedia.org/wiki/Regular_expression) matching with partial match detection for smart buffering. Handles complex patterns, wildcards, and character classes that span chunk boundaries.

- **Algorithm**: Partial regex matching with buffering of prefix matches
- **Performance**: O(n×p), variable depending on pattern complexity
- **Use Case**: Complex patterns, wildcards, character classes
- **Exports**: `RegexSearchStrategy`, and `LeanRegexSearchStrategy` for a smaller bundle (see [Lean Bundles](./regex/README.md#lean-bundles))

## 🚧 Buffer limit

Every strategy holds back no more than `maxBufferLength` code units (65,536 by default) awaiting a decision. See [Buffer limit](../../README.md#buffer-limit).

### What `onGuardExceeded` can do

`onGuardExceeded` is called synchronously, before the text it releases is emitted, from the search that takes a held match past the limit. That search usually runs in a `write()`, but can also run as the stream closes or, for [`nested()`](../engines/lookahead-transform-engine/README.md#recursive-replacement) content, as output drains. The callback can:

- **Notify:** the match passes through as text, and replacing carries on.
- **Stop replacing:** abort the engine's [`stopReplacingSignal`](../../README.md#limit-replacements). The released text, and the rest of the stream, pass through verbatim, except that `LookaheadTransformEngine` still runs a replacement it has already called, such as one for an outer match found after the `nested()` content in which the limit was crossed. It also passes through an earlier match whose replacement it hasn't called yet, even one in the same `write()`, [as for any abort](../engines/lookahead-transform-engine/README.md#stopping-new-replacements-stopreplacingsignal). The callback may run again later in the same chunk, so make it safe to repeat.

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

## 📊 Benchmark Strategies

Additional search strategy implementations exist for performance comparison and algorithmic research. These are **not part of the public API** but are maintained as [reference implementations](../../test/benchmarks/references/README.md) alongside the benchmarks, for optimization insights and algorithm comparison.
