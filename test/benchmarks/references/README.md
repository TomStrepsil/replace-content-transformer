# Reference Implementations

Search strategies and engine shapes kept to compare against the shipped code. None of them is part of the public API or the published build.

Each [harness](../harnesses/README.md) runs one implementation through a common interface. [`algorithm/comparisons.ts`](../algorithm/comparisons.ts) groups the harnesses into the [comparisons](#️-comparisons) below, each measured against a baseline in the production shape, and `npm run bench:algorithms` prints a summary of each after the full results.

## 🗂️ Layout

```
references/
├── algorithms/              SearchStrategy implementations, run through the production engines
│   └── <algorithm>/
└── engine-shapes/           the search and replacement joined differently
    └── <shape>/<algorithm>/
```

An implementation under `algorithms/` differs from the shipped strategies only in its search algorithm. One under `engine-shapes/` differs in how search results reach the output, and its folder name is the algorithm it carries: `engine-shapes/fused-callback/regex` is the regex algorithm in the fused-callback shape.

## ⚖️ Comparisons

Each comparison compares the other harnesses with a baseline that reports to a sink through the production engines. Every baseline is a shipped strategy except Buffered IndexOf Anchored: the fused buffered-indexOf shapes carry that reference algorithm, so it is the baseline that differs from them only in shape. Its ratios describe the cost of each shape, not the speed of the shipped strategies.

| Comparison | Question | Baseline | Compared with |
| --- | --- | --- | --- |
| **Search algorithms** | Which algorithm finds anchors fastest, in the production shape and the sync engine? | Looped IndexOf Anchored | Buffered IndexOf Anchored, Regex, and the four Anchor Sequence compositions (Looped IndexOf, Buffered IndexOf, KMP, Regex) |
| **Nesting count** | Does a pre-compiled regex count opening delimiters faster than a `while`/`indexOf` loop? | Balanced Pair | Balanced Pair (regex count) |
| **Sync vs async engine** | What does the async serial engine cost over the sync one? | Looped IndexOf Anchored | Looped IndexOf Anchored (Async) |
| **Engine shapes: looped-indexOf** | What does reporting to a sink cost, compared with yielding to a generator engine or fusing the replacement into the scan? | Looped IndexOf Anchored | Looped IndexOf Anchored (generator engine), Looped IndexOf Callback |
| **Engine shapes: buffered-indexOf** | As above, for blind buffering, including the fused generator and the fused `Transformer` | Buffered IndexOf Anchored | Buffered IndexOf Anchored Callback, Buffered IndexOf Callback, Buffered IndexOf Canonical, Buffered IndexOf Generator Canonical |
| **Engine shapes: regex** | As above, for regex | Regex | Regex Callback, Regex Canonical |

Each comparison aims to hold everything fixed but one thing. Two things are not held fixed:

- Every benchmark scenario uses two anchors. The two-anchor implementations (buffered-indexOf callback, canonical and generator, and looped-indexOf callback) are specialised for that, so some of their lead can come from the specialisation rather than the shape.
- Looped IndexOf Callback follows [looped-indexOf-cancellable](./algorithms/looped-indexOf-cancellable/README.md)'s algorithm, not `looped-indexOf-anchored`'s, so it differs from its baseline in algorithm as well as shape. The generator engine is the like-for-like comparison.

## 🧭 Algorithms

Each implements `SearchStrategy`, so it runs through the production engines and differs from the shipped strategies only in its search algorithm. They demonstrate:

- **Async vs sync overhead** - the cost of async iteration in streaming scenarios
- **Runtime optimisation supremacy** - brute-force approaches (e.g., `indexOf`, regex) leveraging native runtime optimisations outperform hand-rolled algorithmic "improvements" like Knuth-Morris-Pratt, due to the efficiency of highly-optimised engine internals vs JavaScript-level implementations

### Buffered IndexOf (Blind Buffering)

Simple, efficient strategies using **blind buffering** (always buffer last N-1 characters). Using `indexOf` for exact string matching only.

- **[buffered-indexOf-anchored](./algorithms/buffered-indexOf-anchored/README.md)** - N-token blind buffering, through the production engines.
- **[buffered-indexOf-cancellable](./algorithms/buffered-indexOf-cancellable/README.md)** - Single-token matching with cancellation support (so can be composed into the `anchor-sequence` meta-strategy)

### Looped IndexOf (Smart Buffering)

Strategies using **smart buffering** (only buffer when suffix matches needle prefix), via a brute-force loop over possible prefix/suffix matches using `indexOf`. Slightly less performant than blind buffering, but emits non-matches earlier. The shipped [`looped-indexOf-anchored`](../../../src/search-strategies/looped-indexOf-anchored/README.md) is in this family.

- **[looped-indexOf-cancellable](./algorithms/looped-indexOf-cancellable/README.md)** - Smart buffering with cancellation support (so can be composed into the `anchor-sequence` meta-strategy).

### IndexOf + Knuth-Morris-Pratt

Single-pattern matching using `indexOf` for optimistic searching, then using the **[Knuth-Morris-Pratt](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm) algorithm** for smart buffering of potential cross-chunk matches, with single-pass of chunk suffixes. No "buffer" (other than the [partial match table](<https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm#%22Partial_match%22_table_(also_known_as_%22failure_function%22)>) itself) and innate ability to "continue" a match with index into the table as the only state.

- **[indexOf-knuth-morris-pratt](./algorithms/indexOf-knuth-morris-pratt/README.md)** - KMP-based pattern matching (typically slower than brute-force `indexOf` due to runtime optimisation). Supports "cancellation" for `anchor-sequence` meta-strategy.

### Meta-Strategies

Composable strategy for sequential pattern matching across multiple sub-strategies.

- **[anchor-sequence](./algorithms/anchor-sequence/README.md)** - Composes multiple "cancellable" strategies for sequential matching.
- **[balanced-pair-regex-count](./algorithms/balanced-pair-regex-count/README.md)** - Extends the publicly exported [`balanced-pair`](../../../src/search-strategies/balanced-pair/README.md) strategy, overriding only how it counts the opening delimiters within a match: with [`String.prototype.match()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match#regexp), where `balanced-pair` uses a `while`/`indexOf` loop.

### Algorithm Characteristics

Performance characteristics are "hypothetical", and may not match benchmark results[^1]. The v8 javascript engine also uses adaptive strategies for `indexOf` based on string length, shifting from a single character [memchar](https://en.cppreference.com/w/c/string/byte/memchr.html) style, through [linear search](https://chromium.googlesource.com/v8/v8/%2B/refs/heads/main/src/strings/string-search.h#250) until the pattern length hits [7 characters](https://chromium.googlesource.com/v8/v8/%2B/refs/heads/main/src/strings/string-search.h#43) when it begins measuring [**badness**](https://chromium.googlesource.com/v8/v8/%2B/refs/heads/main/src/strings/string-search.h#503) and utilising [Boyer-Moore-Horspool](https://en.wikipedia.org/wiki/Boyer%E2%80%93Moore%E2%80%93Horspool_algorithm) before eventually switching to full [Boyer–Moore](https://en.wikipedia.org/wiki/Boyer%E2%80%93Moore_string-search_algorithm).

Pre-emptive optimisation via initial implementation of [Knuth-Morris-Pratt](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm)[^2] proved ineffective at beating brute-force approaches under benchmarking, so disregarded in the final library.

| Strategy Family                | Buffering Approach          | Performance       | Use Case                                        |
| ------------------------------ | --------------------------- | ----------------- | ----------------------------------------------- |
| **buffered-indexOf**           | Blind (always buffer)       | O(n), very fast   | Simple two-token patterns, performance-critical |
| **looped-indexOf**             | Smart (validate prefix)     | O(n+m), efficient | Minimise unnecessary buffering                  |
| **indexOf-knuth-morris-pratt** | KMP (smart prefix table)    | O(n+m), slower    | Benchmarking: hand-rolled vs runtime-optimised  |
| **regex**                      | Partial regex matching      | O(n×p), variable  | Complex patterns, wildcards, character classes  |
| **anchor-sequence**            | Delegates to sub-strategies | Varies            | Sequential multi-pattern matching               |

[^1]: Probably due to [SIMD](https://en.wikipedia.org/wiki/Single_instruction,_multiple_data) optimisations in the underlying runtime, not afforded to event loop Javascript.

[^2]: More suitable than Boyer-Moore-Horspool for streaming scenarios since does not need to "peek" / look ahead & avoids holding or re-checking characters that are skipped, which would imply more complex buffering requirement.

### Key Performance Insights

1. **Native runtime optimisations dominate** - Brute-force approaches using `indexOf` and regex consistently outperform hand-rolled algorithmic optimisations like KMP, due to highly-optimised engine internals (V8/JavaScriptCore implemented in C++, with SIMD optimisations)
2. **Async has significant cost** - Async iteration adds substantial overhead compared to synchronous processing
3. **Smart buffering trade-offs** - Smart buffering (looped-indexOf) emits earlier and reduces memory use between chunks, but adds marginal CPU overhead vs blind buffering

## 🧩 Engine Shapes

The production shape is a **sink**: `SearchStrategy.processChunk` calls `sink.reportText()` and `sink.reportMatch()`, and the engine replaces each match inline. The shapes here differ in **how search results reach the output**.

| Shape | How a result reaches the output | Implementations |
| --- | --- | --- |
| **Generator engine** | `processChunk` yields `MatchResult`s, and the engine iterates them | [engine](./engine-shapes/generator-engine/engine.ts), with [looped-indexOf-anchored](./engine-shapes/generator-engine/looped-indexOf-anchored/search-strategy.ts) |
| **Fused generator** | One generator yields output strings, with the replacement inside it | [buffered-indexOf](./engine-shapes/fused-generator/buffered-indexOf/README.md) |
| **Fused callback** | The scan calls the replacement and an enqueue callback itself | [buffered-indexOf](./engine-shapes/fused-callback/buffered-indexOf/README.md), [buffered-indexOf-anchored](./engine-shapes/fused-callback/buffered-indexOf-anchored/README.md), [looped-indexOf](./engine-shapes/fused-callback/looped-indexOf/README.md), [regex](./engine-shapes/fused-callback/regex/README.md) |
| **Fused transformer** | A WHATWG [`Transformer`](https://streams.spec.whatwg.org/#transformer-api) does everything, based on the [canonical example](https://streams.spec.whatwg.org/#example-ts-lipfuzz) | [buffered-indexOf](./engine-shapes/fused-transformer/buffered-indexOf/README.md), [regex](./engine-shapes/fused-transformer/regex/README.md) |

The fused shapes have no boundary between search and replacement, so they bound what keeping strategies and engines separate costs. They are also less flexible: no pluggable strategies, no async engines, and no stopping part-way.

The **generator engine** isolates the interface itself. Its strategy is `StringAnchorSearchStrategy` as it was before the sink, and its engine does the same work per match as `SyncReplacementTransformEngine`, less the check for an iterable replacement, so the only difference from the production pair is how results arrive: yielded to an iterating engine rather than passed to a sink. Anything left over favours the generator, so the comparison understates what the sink saves. Only looped-indexOf, the shipped anchor algorithm, runs in it: other algorithms in the generator engine would repeat the same comparison.

The generator engine is cheaper to build, since it has no `stopReplacingSignal` or `settle` handling. The benchmark scenarios build a transformer per iteration and hold only a few matches, so in them that construction cost can outweigh the per-match difference.

## 🧪 Testing

These are reference implementations: the fastest reasonable code for a given approach, kept as a yardstick for the production code. They don't need full test coverage or defensive hardening, since guards for behaviour no shipped strategy exhibits would distort the comparison.

They must still produce correct output on the happy path. Each one has a [harness](../harnesses/README.md) that runs through the shared validation scenarios; scenarios an implementation isn't designed for are skipped through the harness rather than special-cased in the implementation.
