# Balanced Pair (Regex Count) Search Strategy

A benchmarking variant of [`BalancedPairSearchStrategy`](../../balanced-pair/README.md) that replaces the `while`/`indexOf` loop used to count opening delimiters with a pre-compiled `RegExp` and `String.match()`.

## Purpose

This strategy exists as a **benchmarking proof-of-concept** to answer the question: _is a pre-compiled regex faster than a `while`/`indexOf` loop for counting opening delimiter occurrences within matched content?_

The hypothesis is that:

1. The `RegExp` object is compiled once at construction, amortising that cost across all matches
2. `String.match()` delegates to native regex engine internals, potentially using SIMD-optimised string scanning

**The answer is no** — see [Benchmark Findings](#benchmark-findings) below.

## What Changes

The only difference from `BalancedPairSearchStrategy` is the opening delimiter counter. The public strategy uses a `while`/`indexOf` loop with a cursor:

```typescript
// BalancedPairSearchStrategy (public)
let cursor = 0;
while ((cursor = newContent.indexOf(this.opening, cursor)) !== -1) {
  state.nestingLevel++;
  cursor += this.opening.length;
}
```

This variant pre-compiles the opening delimiter into a `RegExp` at construction and counts with `match()`:

```typescript
// BalancedPairRegexCountSearchStrategy (this variant)
// — constructor —
this.openingRegex = new RegExp(escapeRegExp(opening), "g");

// — processChunk —
state.nestingLevel += newContent.match(this.openingRegex)?.length ?? 0;
```

Everything else — the anchor strategy delegation, nesting logic, buffer management, and state shape — is identical.

## Benchmark Findings

Benchmarked against the public `BalancedPairSearchStrategy` using `npm run bench:algorithms` (Node.js, mitata):

### Construction cost

| Strategy                    | Time/iter | vs indexOf loop |
| --------------------------- | --------- | --------------- |
| `Balanced Pair`             | ~167 ns   | baseline        |
| `Balanced Pair (regex count)` | ~341 ns   | **~2× slower**  |

`new RegExp(...)` compiles the pattern into an internal state machine even for a simple literal, which dominates construction time. The `indexOf` loop approach stores only a plain string reference — near zero overhead.

### Runtime per-scenario

Across all benchmark scenarios (no-match fast-path, dense matches, cross-chunk matches, large chunks, pathological cases), the two strategies are **within measurement noise** of each other. Representative samples:

| Scenario                             | `Balanced Pair` | `Balanced Pair (regex count)` |
| ------------------------------------ | --------------- | ----------------------------- |
| Single chunk, multiple patterns      | ~1.45 µs        | ~1.49 µs                      |
| Cross-chunk boundary (50/50 split)   | ~1.52 µs        | ~1.52 µs                      |
| High match density (3 chunks×3)      | ~2.06 µs        | ~2.21 µs                      |
| No matches (10 chunks)               | ~2.77 µs        | ~2.73 µs                      |
| Pathological: repeated-prefix tokens | ~2.63 µs        | ~2.85 µs                      |

No scenario showed a consistent runtime advantage for the regex variant.

## Why the Regex Approach Does Not Win

### Construction overhead is inherent

Even a trivial literal pattern like `/(/)` must be compiled into a finite-state machine representation. `new RegExp(...)` is not free regardless of how simple the expression is, so the construction penalty is real and unavoidable.

### `match()` allocates; `indexOf` does not

`String.match()` with the `g` flag returns an `Array` of all matched substrings — strings we immediately discard, keeping only `.length`. That allocation and GC pressure is avoided entirely by the `indexOf` cursor loop, which only increments an integer counter.

### `indexOf` is also runtime-optimised

The key assumption behind the hypothesis — that `match()` can leverage SIMD string scanning unavailable to `indexOf` — does not hold. V8's `String.prototype.indexOf` implementation is also implemented in C++ and uses adaptive search strategies (linear search for short patterns, Boyer-Moore-Horspool for longer ones, with character frequency heuristics). For the short literal delimiters that `BalancedPairSearchStrategy` is typically constructed with, both paths hit the same fast native code path.

### The counter runs only on match content

Unlike the primary scan of the haystack (where SIMD search over a large string could in principle pay off), the opening-counter only runs over the matched content — typically a small string. The per-call overhead of entering the regex engine outweighs any benefit from SIMD for short inputs.

## Conclusion

Keep the `while`/`indexOf` loop in `BalancedPairSearchStrategy`. It is:

- **~2× cheaper to construct** — no regex compilation
- **Allocation-free** — increments an integer, no array created
- **Equivalent at runtime** — native `indexOf` is comparably optimised to `String.match()` for short literal patterns

This variant is retained here as evidence for that conclusion and for future re-evaluation under different runtimes or if the delimiter counting logic changes materially.
