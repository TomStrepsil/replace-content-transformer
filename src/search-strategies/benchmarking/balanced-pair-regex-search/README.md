# Balanced Pair (Regex Search) Search Strategy

A benchmarking variant of [`BalancedPairSearchStrategy`](../../balanced-pair/README.md) that finds each delimiter with a pre-compiled `RegExp` instead of `String.prototype.indexOf()`.

## Purpose

This strategy exists as a **benchmarking proof-of-concept** to answer the question: _is a `RegExp` compiled once at construction faster than `indexOf` for finding a literal delimiter?_

The hypothesis is that:

1. The `RegExp` object is compiled once, at construction, amortising that cost across every search
2. `RegExp.prototype.exec()` delegates to the native regex engine, which might scan faster than `indexOf`

**The answer is no**. See [Benchmark Findings](#benchmark-findings) below.

## What Changes

`BalancedPairSearchStrategy` finds delimiters through `HeldText`, whose `search` method calls `indexOf`:

```typescript
// HeldText (used by BalancedPairSearchStrategy)
protected search(text: string, anchorIndex: number, from: number): number {
  return text.indexOf(this.anchors[anchorIndex], from);
}
```

This variant compiles each delimiter into a global `RegExp` at construction, and overrides `search` to run it from `from`:

```typescript
// BalancedPairRegexSearchStrategy (this variant)
// — constructor —
this.patterns = this.anchors.map((anchor) => new RegExp(escapeRegExp(anchor), "g"));

// — RegexHeldText.search —
const pattern = this.patterns[anchorIndex];
pattern.lastIndex = from;
return pattern.exec(text)?.index ?? -1;
```

Everything else is inherited unchanged: the stack of open delimiters, the buffer guard, the handling of held text, and the state shape.

## Benchmark Findings

Benchmarked against the public `BalancedPairSearchStrategy` using `npm run bench:algorithms` (Node.js 24, mitata, Apple M4):

### Construction cost

| Strategy                       | Time/iter | vs `indexOf` |
| ------------------------------ | --------- | ------------ |
| `Balanced Pair`                | ~198 ns   | baseline     |
| `Balanced Pair (regex search)` | ~620 ns   | **~3.1× slower** |

Two `RegExp` objects are compiled, one per delimiter.

### Runtime per scenario

The regex variant is slower in **every** scenario, by 1.08× to 1.22×. Representative samples:

| Scenario                                    | `Balanced Pair` | `Balanced Pair (regex search)` |
| ------------------------------------------- | --------------- | ------------------------------ |
| Single chunk, multiple patterns             | ~1.54 µs        | ~1.75 µs                       |
| Cross-chunk boundary (50/50 split)          | ~1.65 µs        | ~1.84 µs                       |
| High match density (3 chunks, 3 per chunk)  | ~2.89 µs        | ~3.52 µs                       |
| No matches (10 chunks)                      | ~2.66 µs        | ~2.87 µs                       |
| Pathological: Repeated prefix cross-chunk   | ~2.16 µs        | ~2.47 µs                       |
| Long tokens (15 chars) cross-chunk          | ~2.24 µs        | ~2.56 µs                       |

## Why the Regex Approach Does Not Win

### Construction overhead is inherent

Even a trivial literal pattern like `/\(/` must be compiled into the regex engine's internal representation. `new RegExp(...)` is not free regardless of how simple the expression is.

### `exec()` allocates; `indexOf` does not

Each `exec()` that finds a delimiter returns a match array, which is discarded once its `index` is read. `indexOf` returns a number.

### `indexOf` is also runtime-optimised

V8's `String.prototype.indexOf` is implemented natively and adapts its search to the pattern (a single-character scan for short patterns, Boyer-Moore-Horspool for longer ones). For the short literal delimiters this strategy is typically given, the regex engine has nothing faster to offer.

### The search is now on the hot path

The earlier variant, `BalancedPairRegexCountSearchStrategy`, only used a `RegExp` to count opening delimiters inside each match, and its runtime was within noise of `indexOf`. Here every delimiter search goes through the regex engine, so the per-call cost of entering it shows in every scenario.

## History: counting opening delimiters

Before the buffer guard ([#100](https://github.com/TomStrepsil/replace-content-transformer/issues/100)), `BalancedPairSearchStrategy` matched each opening–closing span with the anchor strategy, then counted the opening delimiters inside it with a `while`/`indexOf` loop to track nesting. `BalancedPairRegexCountSearchStrategy` counted them with `newContent.match(openingRegex)?.length` instead. It was about 2× slower to construct (~341 ns vs ~167 ns) and within measurement noise at runtime (e.g. ~1.45 µs vs ~1.49 µs for a single chunk with several patterns, ~2.06 µs vs ~2.21 µs at high match density). The strategy now tracks nesting with a stack and counts nothing, so this variant compares delimiter search instead.

## Conclusion

Keep `indexOf` in `HeldText`. It is:

- **~3× cheaper to construct**: no regex compilation
- **Allocation-free**: returns a number, with no match array created
- **Faster at runtime**: by 8–22% across every benchmark scenario

This variant is retained as evidence for that conclusion, and for re-evaluation under different runtimes.
