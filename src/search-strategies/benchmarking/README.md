# Benchmark Search Strategies

This directory contains various search strategy implementations used for **performance benchmarking and algorithm comparison**. These are not part of the public API but are maintained for research and optimization insights.

## 🐬 Purpose

These strategies exist as **proof-of-concept implementations**, demonstrating:

- **Generator vs Callback overhead** - Measuring the performance cost of generator protocol vs direct callbacks
- **Async vs Sync overhead** - Quantifying the cost of async iteration in streaming scenarios
- **Runtime optimisation supremacy** - Demonstrating that brute-force approaches (e.g., `indexOf`, regex) leveraging native runtime optimisations outperform hand-rolled algorithmic "improvements" like Knuth-Morris-Pratt, due to the efficiency of highly-optimised engine internals vs JavaScript-level implementations
- **API ergonomics vs performance** - Exploring trade-offs between developer experience (generators, composability) and raw throughput

## 👪 Strategy Families

### Buffered IndexOf (Blind Buffering)

Simple, efficient strategies using **blind buffering** (always buffer last N-1 characters). Using `indexOf` for exact string matching only.

- **[buffered-indexOf-canonical](./buffered-indexOf-canonical/README.md)** - Two-token start/end matching with blind buffering, based on a [WHATWG canonical example](https://streams.spec.whatwg.org/#example-ts-lipfuzz), but using `indexOf` rather than `RegExp`. A direct [`Transformer`](https://streams.spec.whatwg.org/#transformer-api) implementation.
- **[buffered-indexOf-canonical-generator](./buffered-indexOf-canonical-generator/README.md)** - Copy of `buffered-indexOf-canonical` using a [generator function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*) that yields to an enqueuing processor. Used to benchmark generator overhead vs direct `Transformer`.
- **[buffered-indexOf-callback](./buffered-indexOf-callback/README.md)** - Callback-based variant for measuring callback vs generator performance.
- **[buffered-indexOf-anchored-callback](./buffered-indexOf-anchored-callback/README.md)** - N-token callback-based variant.
- **[buffered-indexOf-cancellable](./buffered-indexOf-cancellable/README.md)** - Single-token matching with cancellation support (so can be composed into the `anchor-sequence` meta-strategy)

### Looped IndexOf (Smart Buffering)

Strategies using **smart buffering** (only buffer when suffix matches needle prefix), via a brute-force loop over possible prefix/suffix matches using `indexOf`. Slightly less performant than blind buffering, but yields non-matches earlier.

- **[looped-indexOf-cancellable](./looped-indexOf-cancellable/README.md)** - Smart buffering with cancellation support (so can be composed into the `anchor-sequence` meta-strategy).
- **[looped-indexOf-callback](./looped-indexOf-callback/README.md)** - Callback-based variant.

### IndexOf + Knuth-Morris-Pratt

Single-pattern matching using `indexOf` for optimistic searching, then using the **[Knuth-Morris-Pratt](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm) algorithm** for smart buffering of potential cross-chunk matches, with single-pass of chunk suffixes. No "buffer" (other than the [partial match table](<https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm#%22Partial_match%22_table_(also_known_as_%22failure_function%22)>) itself) and innate ability to "continue" a match with index into the table as the only state.

- **[indexOf-knuth-morris-pratt](./indexOf-knuth-morris-pratt/README.md)** - KMP-based pattern matching (typically slower than brute-force `indexOf` due to runtime optimisation). Supports "cancellation" for `anchor-sequence` meta-strategy.

### Regex

Pattern matching using **regular expressions**, with partial match detection for smart buffering.

- **[regex-callback](./regex-callback/README.md)** - Callback-based variant.
- **[regex-canonical](./regex-canonical/README.md)** - Direct `Transformer` implementation based on WHATWG Streams specification example.

### Meta-Strategy

Composable strategy for sequential pattern matching across multiple sub-strategies.

- **[anchor-sequence](./anchor-sequence/README.md)** - Composes multiple "cancellable" strategies for sequential matching.

## 📊 Algorithm Comparison

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

## 🏃‍♂️ Execution Patterns

### Generator-Based

- **Benefits**: Yield-on-demand, lazy evaluation, better flow control, composability
- **Cost**: Generator protocol overhead
- **Variants**: Standard generators, cancellable generators (for composition)

### Callback-Based

- **Benefits**: No generator overhead, simpler integration with callback APIs
- **Cost**: Less composable, harder to control flow
- **Variants**: Callback versions of core algorithms

### Direct Transformer

- **Benefits**: Minimal overhead, direct integration with Web Streams API
- **Cost**: Less flexible, harder to compose
- **Variants**: Based on canonical implementation from spec (`buffered-indexOf-canonical`, `regex-canonical`)

### Cancellable

- **Benefits**: Early termination (via `try` / `finally` capturing mid-chunk to a `flush()` buffer), composable with `anchor-sequence`
- **Behaviour**: Gracefully finishes current iteration, preserves buffered content, iteration ends via `break` or `return` which automatically triggers `finally` blocks

## 💡 Key Performance Insights

The implementations in this directory have revealed several key performance insights:

1. **Native runtime optimisations dominate** - Brute-force approaches using `indexOf` and regex consistently outperform hand-rolled algorithmic optimisations like KMP, due to highly-optimised engine internals (V8/JavaScriptCore implemented in C++, with SIMD optimisations)
2. **Generator overhead is measurable** - Generator-based strategies have ~5-15% overhead compared to callback variants
3. **Async has significant cost** - Async iteration adds substantial overhead compared to synchronous processing
4. **Smart buffering trade-offs** - Smart buffering (looped-indexOf) yields earlier and reduces memory use between chunks, but adds marginal CPU overhead vs blind buffering

See [`test/benchmarks/`](../../../test/benchmarks/README.md) for detailed performance measurements.
