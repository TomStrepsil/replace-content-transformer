# Buffered IndexOf Cancellable

A single-needle search strategy with explicit "cancellation" support, designed to be composed within the [anchor-sequence](../anchor-sequence) meta-strategy.

## Purpose

Unlike [buffered-indexOf-canonical](../buffered-indexOf-canonical) which handles two-token start/end matching, this strategy:

- ✅ **Matches a single needle only** - Takes one string pattern
- ✅ **Supports cancellation** - Uses `finally` block to preserve buffer when iteration stops
- ✅ **Designed for composition** - Intended as a building block for the anchor-sequence meta-strategy

The anchor-sequence meta-strategy orchestrates multiple instances of this strategy to handle sequential multi-token matching (e.g., `{{`, content, `}}`), with each sub-strategy responsible for finding a single needle.

## Algorithm

Uses a **blind buffering** approach:

- Always buffers last `needle.length - 1` characters
- Simple and efficient for single-pattern matching
- No complex prefix/suffix validation needed

### Comparison with Alternative Single-Needle Strategies

All three strategies support single-needle matching with cancellation, making them suitable for composition with anchor-sequence. The key differences are in **buffering strategy** and **validation cost**:

| Strategy                           | Buffering Approach      | Validation Cost                                     | Yield Timing                            | Performance                             |
| ---------------------------------- | ----------------------- | --------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| **buffered-indexOf-cancellable**   | Blind                   | Zero (no validation)                                | Yields non-match tail on next chunk     | Fastest (native `indexOf`)              |
| **looped-indexOf-cancellable**     | Smart (brute-force)     | O(n) loop checking every suffix via `indexOf`       | Yields non-match tail one chunk earlier | Fast (native `indexOf`, small overhead) |
| **indexOf-knuth-morris-pratt**     | Smart (KMP prefix table)| O(n) iteration over potential match using KMP table | Yields non-match tail one chunk earlier | Slower (JS-level algorithm)             |

#### Blind Buffering (buffered-indexOf-cancellable)

**Zero validation cost** - Simply buffers last `(needle.length - 1)` characters:

```typescript
// No checking needed - just slice and buffer
state.buffer = haystack.slice(-(needle.length - 1));
```

**Trade-off:** The tail of each chunk sits in the buffer until the next chunk arrives, then gets yielded as non-match if no pattern found. This delays yielding by one chunk, but costs zero CPU cycles to determine.

#### Smart Buffering with Brute-Force Validation (looped-indexOf-cancellable)

**Brute-force suffix checking** - Loops through possible suffix lengths, checking each with `indexOf`:

```typescript
// Check every possible suffix from longest to shortest
for (let len = needle.length - 1; len >= 1; len--) {
  const suffix = haystack.slice(-len);
  const prefix = needle.slice(0, len);
  if (suffix === prefix) { // Uses indexOf internally for comparison
    buffer = suffix;
    break;
  }
}
```

**Trade-off:** Yields non-match tail immediately (one chunk earlier than blind buffering), but requires O(n) loop with multiple `indexOf`-style comparisons per chunk. Still fast due to native string operations.

#### Smart Buffering with KMP Algorithm (indexOf-knuth-morris-pratt)

**KMP prefix table** - Uses precomputed failure function for a single-pass, character-by-character iteration:

```typescript
// Single pass through haystack, character-by-character
let j = state.needleIndex;
for (let i = 0; i < haystack.length; i++) {
  while (j > 0 && haystack[i] !== needle[j]) {
    j = kmpTable[j - 1]; // Jump using failure function
  }
  if (haystack[i] === needle[j]) {
    j++;
  }
  // ... more JS-level logic
}
```

**Trade-off:** Yields non-match tail immediately (same as looped-indexOf). KMP makes a **single pass** through the haystack without backtracking, which is algorithmically optimal. However, this single pass requires:
- **Character-by-character iteration** in JavaScript (accessing `haystack[i]` and `needle[j]` individually)
- **Conditional branching** on every character (`while` loops, `if` statements)
- **Array lookups** for the KMP failure table (`kmpTable[j - 1]`)

All of this happens at **JavaScript speed**, which cannot compete with the runtime-optimized string operations used by looped-indexOf.

**Why single-pass is slower than multiple slices:**

Despite KMP's theoretical advantage (single pass vs multiple attempts), the looped-indexOf approach uses **native string comparison** for each suffix check:

```typescript
if (suffix === prefix) // Native runtime comparison (SIMD-optimized)
```

Each equality check delegates to highly-optimized C++ string comparison routines that can process multiple bytes simultaneously (SIMD). Even checking `needle.length - 1` suffixes is faster than iterating character-by-character in JavaScript, because:
- Native string operations are **orders of magnitude faster** than JS-level character access
- Progressive slicing creates string views (cheap) that get compared at native speed
- KMP's single-pass benefit is negated by the cost of JS-level iteration

#### Benchmarking Insight

**The paradox:** KMP is algorithmically superior (avoids redundant comparisons), yet performs worse than both brute-force approaches:

1. **Blind buffering** (this strategy) - Fastest due to zero validation cost and native `indexOf`. Accepts one-chunk delay in yielding tail.
2. **Looped brute-force** - Nearly as fast, leverages native string operations despite checking every suffix. Yields tail immediately.
3. **KMP algorithm** - Slowest, despite theoretical efficiency. JS-level iteration can't compete with highly-optimized runtime internals (SIMD, etc.).

**Conclusion:** Runtime optimizations dominate algorithmic cleverness. Native `indexOf` with simple logic outperforms hand-rolled "smart" algorithms implemented in JavaScript.

## Execution Pattern

The key difference is the **execution pattern**:

| Variant                          | Execution        | Cancellation      |
| -------------------------------- | ---------------- | ----------------- |
| **buffered-indexOf-cancellable** | Generator        | Explicit `return` |
| buffered-indexOf-canonical       | Direct processor | N/A               |
| buffered-indexOf-callback        | Callback         | N/A               |

### Cancellable Generator Pattern

This variant implements `SearchStrategy<TState>` with `finally` block for cancellation:

```typescript
*processChunk(
  chunk: string,
  state: BufferedIndexOfCancellableState
): Generator<MatchResult, void, undefined> {
  try {
    yield { content: "...", match: false };
  } finally {
    // Executes when iteration stops (break, return, completion)
    state.buffer = /* preserve remaining content */;
  }
}
```

**Benefits of generator-based execution:**

- ✅ **Yield-on-demand** - Consumer controls when to request next result, enabling better flow control
- ✅ **Lazy evaluation** - Only processes as much as needed, not entire chunk at once
- ✅ **Composability** - Can be composed into meta-strategies like [anchor-sequence](../anchor-sequence)

## Cancellation Behaviour

When iteration stops (via break, return, or loop completion):

1. **Finishes current iteration** - Any remaining content in the current haystack is yielded as non-match via the `finally` block
2. **Preserves buffered content** - Partial match buffer remains intact and accessible via `flush(state)`
3. **Graceful termination** - No data loss; you can still retrieve buffered content after cancellation

**Example:**

```typescript
const strategy = new BufferedIndexOfCancellableStrategy("{{");
const state = strategy.createState();
const generator = strategy.processChunk(
  "First {{match and second {{match",
  state
);

for (const result of generator) {
  if (result.match) {
    // Stop after first match - triggers finally block
    break;
  }
}

// finally block has executed, buffered content preserved
const buffered = strategy.flush(state); // Returns any buffered partial match
```

**Composition with anchor-sequence:**

```typescript
import { AnchorSequenceSearchStrategy } from "../anchor-sequence";
import { BufferedIndexOfCancellableSearchStrategy } from "../buffered-indexOf-cancellable";

// Match {{...}} by composing two single-needle strategies
const strategy = new AnchorSequenceSearchStrategy([
  new BufferedIndexOfCancellableSearchStrategy("{{"),
  new BufferedIndexOfCancellableSearchStrategy("}}")
]);

// The meta-strategy cancels the first sub-strategy when "{{" is found,
// then starts the second to find "}}"
```

## State Management

Simple state structure for single-needle matching:

```typescript
type BufferedIndexOfCancellableState = {
  buffer: string; // Holds last (needle.length - 1) characters
};
```

## Related Strategies

- **[anchor-sequence](../anchor-sequence)** - Meta-strategy that composes multiple instances of this strategy for sequential matching
- **[looped-indexOf-cancellable](../looped-indexOf-cancellable)** - Alternative single-needle cancellable strategy using brute-force suffix checking (yields tail earlier, small CPU cost)
- **[indexOf-knuth-morris-pratt](../indexOf-knuth-morris-pratt)** - Alternative single-needle cancellable strategy using KMP algorithm (for benchmarking comparison, demonstrating JS overhead)
- **[buffered-indexOf-canonical](../buffered-indexOf-canonical)** - Two-token strategy for simple start/end matching (non-cancellable)
- **[buffered-indexOf-anchored](../buffered-indexOf-anchored)** - N-token sequential strategy (handles multiple needles internally)