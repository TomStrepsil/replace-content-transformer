# IndexOf Knuth-Morris-Pratt Search Strategy

A single-needle search strategy using the [Knuth-Morris-Pratt (KMP) algorithm](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm) with explicit "cancellation" support, designed to be composed within the [anchor-sequence](../anchor-sequence) meta-strategy.

## Purpose

This strategy exists primarily as a **benchmarking proof-of-concept** to demonstrate that algorithmically-superior approaches implemented in JavaScript cannot compete with brute-force approaches using runtime-optimized native operations:

- ✅ **Matches a single needle only** - Takes one string pattern
- ✅ **Smart buffering (KMP)** - Uses precomputed failure table for optimal prefix matching
- ✅ **Supports cancellation** - Uses `finally` block to preserve buffer when iteration stops
- ✅ **Designed for composition** - Building block for anchor-sequence meta-strategy
- ⚠️ **Slower than alternatives** - JS-level algorithm overhead outweighs theoretical benefits

### Comparison with Alternative Single-Needle Strategies

All three strategies support single-needle matching with cancellation, making them suitable for composition with anchor-sequence. The key differences are in **buffering strategy** and **validation cost**:

| Strategy                         | Buffering Approach       | Validation Cost                                     | Yield Timing                            | Performance                             |
| -------------------------------- | ------------------------ | --------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| **buffered-indexOf-cancellable** | Blind                    | Zero (no validation)                                | Yields non-match tail on next chunk     | Fastest (native `indexOf`)              |
| **looped-indexOf-cancellable**   | Smart (brute-force)      | O(n) loop checking every suffix via `indexOf`       | Yields non-match tail one chunk earlier | Fast (native `indexOf`, small overhead) |
| **indexOf-knuth-morris-pratt**   | Smart (KMP prefix table) | O(n) iteration over potential match using KMP table | Yields non-match tail one chunk earlier | Slower (JS-level algorithm)             |

#### This Strategy: Smart Buffering with KMP Algorithm

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

All of this happens at **JavaScript speed**, which cannot compete with the runtime-optimized string operations used by the other strategies.

**Why single-pass is slower than multiple slices (looped-indexOf):**

Despite KMP's theoretical advantage (single pass vs multiple attempts), the looped-indexOf approach uses **native string comparison** for each suffix check:

```typescript
if (suffix === prefix) // Native runtime comparison (SIMD-optimized)
```

Each equality check delegates to highly-optimized C++ string comparison routines that can process multiple bytes simultaneously (SIMD). Even checking `needle.length - 1` suffixes is faster than iterating character-by-character in JavaScript, because:

- Native string operations are **orders of magnitude faster** than JS-level character access
- Progressive slicing creates string views (cheap) that get compared at native speed
- KMP's single-pass benefit is negated by the cost of JS-level iteration

**Benchmarking insight:** This strategy demonstrates that **runtime optimizations dominate algorithmic cleverness**. Hand-rolled "smart" algorithms in JavaScript cannot beat simple approaches that leverage native operations, even when doing more work.

See [buffered-indexOf-cancellable](../buffered-indexOf-cancellable#comparison-with-alternative-single-needle-strategies) for detailed performance comparison.

## Algorithm Overview

The `IndexOfKnuthMorrisPrattSearchStrategy` combines innate string search (using `indexOf`) with the KMP algorithm to find patterns that span multiple chunks. This allows the processor to:

- avoid a `needle.length-1` buffer to be held for each failed chunk (awaiting enough for a full-length `indexOf` check)
- avoiding `needle.length-1` calls to `indexOf` for each possible prefix, as a brute-force approach
- yield non-matching content earlier, based on the above

### 1. Initial Search with `indexOf`

When processing a new chunk with no previous partial match, the strategy uses JavaScript's built-in `indexOf` for fast initial searching:

```
Needle:  "PLACEHOLDER"
Chunk:   "Hello PLACEHOLDER world"

Step 1: indexOf("PLACEHOLDER") → finds at position 6
        ↓
Result: Complete match found ✓

┌─────────────────────────────────────┐
│ Chunk: "Hello PLACEHOLDER world"    │
│               ^^^^^^^^^^^           │
│               Match found at pos 6  │
└─────────────────────────────────────┘
```

### 2. Partial Match Detection with KMP

When the chunk ends, we need to check if it contains the beginning of our needle (search pattern). This is where KMP comes in, searching only the **suffix** of the haystack (our candidate search space, the last `needle.length - 1` characters):

```
Needle:  "PLACEHOLDER"  (length: 11)
Chunk:   "Hello PLACE"  (length: 11)
Search window:  "ello PLACE" (last 10 chars: needle.length - 1)

KMP checks suffix: Does "ello PLACE" contain the start of "PLACEHOLDER"?
                   ✓ Yes! 5 characters match

┌─────────────────────────────────────────────────┐
│ Haystack: "ello PLACE"                          │
│                 ^^^^^                           │
│           Suffix matches needle prefix          │
│                                                 │
│ Needle:   "PLACEHOLDER"                         │
│            ^^^^^                                │
│            Matched prefix (needleIndex = 5)     │
└─────────────────────────────────────────────────┘

State after chunk:
  - matchBuffer: "PLACE"
  - needleIndex: 5
  - isMatching: true
```

**Why KMP?** The KMP algorithm uses a pre-computed Longest Prefix-Suffix (LPS) array to efficiently check if the haystack's suffix matches the needle's prefix, without backtracking. This is beneficial for handling patterns that have repeating characters (e.g., "AAAA" or "ABCABC").

### 3. Buffering and State Management

```
Stream flow with needle "PLACEHOLDER":

Chunk 1: "Hello PLA"
┌──────────────────────────────────┐
│ Content: "Hello "                │
│ Partial: "PLA"                   │
└──────────────────────────────────┘
State: matchBuffer = "PLA", needleIndex = 3

Chunk 2: "CEHOLDER world"
┌──────────────────────────────────┐
│ Buffer:  "PLA" (from previous)   │
│ New:     "CEHOLDER"              │
│ Combined: "PLACEHOLDER"          │
│ Remaining: " world"              │
└──────────────────────────────────┘
State: matchBuffer = "", needleIndex = 0
```

### 4. Continuing Search with Matched State

Once we have a partial match (`needleIndex > 0`), subsequent chunks use `indexOf` to search for the **remainder** of the needle:

```
Current state: needleIndex = 5, matchBuffer = "PLACE"
Needle:        "PLACEHOLDER" (need chars 5-10: "HOLDER")
Next chunk:    "HOLDER and more text"

Step 1: Extract needed portion: "HOLDER" (indices 5-10 of needle)
Step 2: indexOf("HOLDER") in chunk → found at position 0
Step 3: Complete match! Combine buffer + new match

┌─────────────────────────────────────────────────────┐
│ Previous buffer: "PLACE"                            │
│ Current chunk:   "HOLDER and more text"             │
│                   ^^^^^^                            │
│ Result: "PLACEHOLDER" = complete match ✓            │
│ Remaining: " and more text"                         │
└─────────────────────────────────────────────────────┘

State after:
  - Yield: "PLACEHOLDER" (match = true)
  - Yield: " and more text" (match = false)
  - matchBuffer: ""
  - needleIndex: 0
  - isMatching: false
```

### Edge Cases Handled

The algorithm correctly handles several tricky scenarios:

**Failed partial matches:**

```
Needle: "PLACEHOLDER"
Chunk 1: "Hello PLACE"  → Buffer "PLACE" (needleIndex = 5)
Chunk 2: "BO wrong"     → No match! Flush buffer "PLACE" as non-match

┌──────────────────────────────────────────┐
│ Expected: "HOLDER..."                    │
│ Got:      "BO wrong"                     │
│ Action:   Flush "PLACE" + "BO wrong"     │
│           Reset needleIndex to 0         │
└──────────────────────────────────────────┘
```

**Overlapping patterns:**

```
Needle: "AAAA"
Chunk:  "AAAAAAA"

Using KMP's LPS array prevents redundant checking:
  "AAAA..." → Match 1 at position 0
     "AAAA" → Match 2 at position 1 (smart skip)
        ... → etc.
```

**Small chunks:**

```
Needle: "PLACEHOLDER"
Chunk 1: "Hello PLACE"  → Buffer "PLACE" (needleIndex = 5)
Chunk 2: "HOL"     → Add "HOL" to buffer (needleIndex = 8)
Chunk 3: "DER"     → Match!
┌──────────────────────────────────────────┐
│ Action:   Flush "PLACEHOLDER"            │
│           Reset needleIndex to 0         │
└──────────────────────────────────────────┘
```

### Performance Characteristics

- **Best case:** O(n) where n is the total input size
  - `indexOf` is highly optimised in modern JavaScript engines
  - Only the last `needle.length - 1` characters use KMP per chunk
- **Worst case:** O(n + m) where m is the needle length

  - KMP guarantees no backtracking
  - Pre-computed LPS array avoids redundant comparisons

- **Memory:** O(m) for the KMP LPS array
  - Buffer size never exceeds needle length
  - No need to buffer entire chunks

## Related Strategies

- **[anchor-sequence](../anchor-sequence)** - Meta-strategy that composes multiple instances of this strategy for sequential matching
- **[buffered-indexOf-cancellable](../buffered-indexOf-cancellable)** - Alternative with blind buffering (fastest, but yields tail one chunk later)
- **[looped-indexOf-cancellable](../looped-indexOf-cancellable)** - Alternative using brute-force suffix checking (faster than KMP, yields tail immediately)
