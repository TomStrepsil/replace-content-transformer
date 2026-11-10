# Looped IndexOf Cancellable Search Strategy

A single-needle search strategy with **smart buffering** and explicit "cancellation" support, designed to be composed within the [anchor-sequence](../anchor-sequence) meta-strategy.

## Purpose

This strategy balances performance and memory efficiency by using **brute-force suffix validation** to minimize unnecessary buffering:

- ✅ **Matches a single needle only** - Takes one string pattern
- ✅ **Smart buffering** - Only buffers when suffix matches needle prefix
- ✅ **Supports stopping at a match** - Uses a `finally` block to keep the rest in `state` when `sink.reportMatch()` returns `false`
- ✅ **Designed for composition** - Building block for anchor-sequence meta-strategy

### Comparison with Alternative Single-Needle Strategies

All three strategies support single-needle matching with cancellation, making them suitable for composition with anchor-sequence. The key differences are in **buffering strategy** and **validation cost**:

| Strategy                         | Buffering Approach       | Validation Cost                                     | Emit Timing                             | Performance                             |
| -------------------------------- | ------------------------ | --------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| **buffered-indexOf-cancellable** | Blind                    | Zero (no validation)                                | Emits non-match tail on next chunk     | Fastest (native `indexOf`)              |
| **looped-indexOf-cancellable**   | Smart (brute-force)      | O(n) loop checking every suffix via `indexOf`       | Emits non-match tail one chunk earlier | Fast (native `indexOf`, small overhead) |
| **indexOf-knuth-morris-pratt**   | Smart (KMP prefix table) | O(n) iteration over potential match using KMP table | Emits non-match tail one chunk earlier | Slower (JS-level algorithm)             |

#### This Strategy: Smart Buffering with Brute-Force Validation

**Brute-force suffix checking** - Loops through possible suffix lengths, checking each with native string comparison:

```typescript
// Check every possible suffix from longest to shortest
for (let len = needle.length - 1; len >= 1; len--) {
  const suffix = haystack.slice(-len);
  const prefix = needle.slice(0, len);
  if (suffix === prefix) {
    // Native string equality (SIMD-optimized)
    buffer = suffix;
    break;
  }
}
```

**Trade-off:** Emits non-match tail immediately (one chunk earlier than blind buffering), with minimal CPU overhead. The loop makes up to `needle.length - 1` comparisons, but each uses **native string operations** (fast).

**Why brute-force beats algorithmic cleverness:**

Despite checking every possible suffix, this approach outperforms the algorithmically-superior KMP algorithm because:

- Each equality check (`suffix === prefix`) delegates to **highly-optimized C++ string comparison** with SIMD
- Progressive slicing creates string views (cheap operations)
- Native operations are orders of magnitude faster than JS-level character iteration
- The overhead of the loop is negligible compared to the speed of native comparisons

See [buffered-indexOf-cancellable](../buffered-indexOf-cancellable#comparison-with-alternative-single-needle-strategies) for detailed performance comparison.

## Algorithm Overview

Unlike the [buffered-indexOf](../../engine-shapes/fused-transformer/buffered-indexOf) family which uses **blind buffering** (always buffer last N-1 characters), this strategy uses **smart buffering**: it only buffers content when the suffix of the chunk actually matches the prefix of the needle.

**Key innovation:** Loop through all possible prefix lengths (from `needle.length - 1` down to 1) and check if the haystack suffix matches the needle prefix. Only buffer if a match is found.

## How It Works

### 1. Optimistic Search with indexOf

First, attempt fast searching using JavaScript's built-in `indexOf`:

```
Needle: "PLACEHOLDER"
Chunk:  "Hello PLACEHOLDER world"

Step 1: indexOf("PLACEHOLDER") → found at position 6
        ↓
┌─────────────────────────────────────┐
│ Chunk: "Hello PLACEHOLDER world"    │
│               ^^^^^^^^^^^           │
│               Complete match found  │
└─────────────────────────────────────┘

Result: "Hello " → non-match
        "PLACEHOLDER" → match
        " world" → non-match
```

### 2. Smart Buffering at Chunk Boundaries

When the chunk ends without finding the complete needle, loop to check if the suffix matches any prefix of the needle:

```
Needle: "PLACEHOLDER" (length 11)
Chunk:  "Hello PLACE"

Loop through possible prefix lengths (10 down to 1):

  Length 10: "ello PLACE" == "PLACEHOLD"? No
  Length 9:  "llo PLACE"  == "PLACEHOLD"? No
  ...
  Length 5:  "PLACE"      == "PLACE"?     Yes! ✓

┌──────────────────────────────────────────────┐
│ Haystack: "Hello PLACE"                      │
│                   ^^^^^                      │
│                   Suffix (5 chars)           │
│                                              │
│ Needle:   "PLACEHOLDER"                      │
│            ^^^^^                             │
│            Prefix (5 chars)                  │
│                                              │
│ Match found! Buffer "PLACE"                  │
└──────────────────────────────────────────────┘

State after chunk:
  - matchBuffer: "PLACE"
  - needleIndex: 5 (next character we're looking for)

Output: "Hello " (non-match)
Buffer: "PLACE"
```

**Why smart buffering?** Only buffer content that could actually be the start of a match. If the chunk ends with `>`, and `>` is not a prefix of `PLACEHOLDER`, don't buffer it — emit it immediately as non-matching content.

### 3. Validate Buffered Content with Next Chunk

When the next chunk arrives, validate the buffered content:

```
Previous state: matchBuffer = "PLACE", needleIndex = 5
Needle:        "PLACEHOLDER"
Next chunk:    "HOLDER and more"

Step 1: Check if next chunk continues the match
        needle.slice(5, 5 + 6) = "HOLDER"
        chunk.slice(0, 6) = "HOLDER"
        Match? Yes! ✓

┌──────────────────────────────────────────────┐
│ Buffer:  "PLACE"                             │
│ Chunk:   "HOLDER and more"                   │
│           ^^^^^^                             │
│           Validated continuation             │
│                                              │
│ Result: "PLACEHOLDER" → match                │
│         " and more" → process remainder      │
└──────────────────────────────────────────────┘

State after:
  - matchBuffer: ""
  - needleIndex: 0
```

### 4. Failed Partial Match

If the next chunk doesn't continue the match, flush the buffer and reset:

```
Previous state: matchBuffer = "PLACE", needleIndex = 5
Needle:        "PLACEHOLDER"
Next chunk:    "BO wrong"

Step 1: Check if next chunk continues the match
        needle.slice(5, 5 + 8) = "HOLDER"
        chunk.slice(0, 2) = "BO"
        Match? No ✗

┌──────────────────────────────────────────────┐
│ Buffer:  "PLACE"                             │
│ Chunk:   "BO wrong"                          │
│           ^^                                 │
│           Does not match "HOLDER"            │
│                                              │
│ Action: Flush "PLACE" as non-match           │
│         Reset needleIndex to 0               │
│         Process "BO wrong" from scratch      │
└──────────────────────────────────────────────┘

Result: "PLACE" → non-match (flushed buffer)
        "BO wrong" → process with smart buffering
```

## State Management

```typescript
type LoopedIndexOfSearchState = {
  matchBuffer: string; // Content buffered from previous chunk
  needleIndex: number; // Position in needle (0 = not matching)
};
```

**State transitions:**

- **Initial:** `matchBuffer = ""`, `needleIndex = 0`
- **Complete match found:** Emit match, reset to initial state
- **Partial match at chunk end:** Buffer suffix that matches needle prefix, set `needleIndex`
- **No partial match:** Emit entire chunk as non-match, stay in initial state
- **Partial match fails:** Flush buffer, reset to initial state, reprocess chunk

## Edge Cases

### No Prefix Match (Don't Buffer)

```
Needle: "PLACEHOLDER"
Chunk:  "Hello >"

Smart buffering check:
  Length 10: "ello >" == "PLACEHOLD"? No
  Length 9:  "llo >"  == "PLACEHOL"?  No
  ...
  Length 1:  ">"      == "P"?         No

No match found → Don't buffer

┌──────────────────────────────────────┐
│ No suffix matches any needle prefix │
│ Emit entire chunk as non-match      │
└──────────────────────────────────────┘

Output: "Hello >" (non-match)
Buffer: "" (empty)
```

Compare to blind buffering which would buffer `>` unnecessarily.

### Repeating Patterns

Smart buffering handles repeating patterns efficiently:

```
Needle: "AAAA"
Chunk:  "BBAAA"

Loop:
  Length 3: "AAA" == "AAA"? Yes! ✓

Output: "BB" (non-match)
Buffer: "AAA"
needleIndex: 3

Next chunk: "A more"
  Validate: "A" matches next char of needle
  Output: "AAAA" (match)
```

### Multiple Matches in Single Chunk

```
Needle: "AB"
Chunk:  "ABABAB"

Process:
  1. indexOf("AB") at 0 → match "AB"
  2. Search remainder "ABAB"
     indexOf("AB") at 0 → match "AB"
  3. Search remainder "AB"
     indexOf("AB") at 0 → match "AB"

Result: "AB" → match (3 times)
```

## Performance Characteristics

- **Best case:** O(n) where n is chunk size

  - `indexOf` finds complete matches quickly
  - No partial matches, no prefix checking needed

- **Worst case:** O(n × m) where m is needle length

  - Must check up to `m - 1` prefix lengths at chunk boundary
  - Each prefix check is O(m) string comparison
  - Rare in practice with typical patterns

- **Average case:** O(n + m)

  - Most chunks don't end mid-pattern
  - When they do, early prefix lengths often match/reject quickly

- **Memory:** O(m) where m is needle length
  - Buffer size never exceeds needle length
  - Only buffers validated prefixes

## Comparison with Other Strategies

| Strategy                   | Buffering               | Efficiency          | Complexity |
| -------------------------- | ----------------------- | ------------------- | ---------- |
| buffered-indexOf           | Blind (always buffer)   | O(n), very fast     | Low        |
| **looped-indexOf**         | Smart (validate prefix) | O(n + m), efficient | Medium     |
| indexOf-knuth-morris-pratt | KMP (smart buffering)   | O(n + m), slower JS | High       |
| regex                      | Partial regex           | O(n × p)            | High       |

## Related Strategies

- **[anchor-sequence](../anchor-sequence)** - Meta-strategy that composes multiple instances of this strategy for sequential matching
- **[buffered-indexOf-cancellable](../buffered-indexOf-cancellable)** - Alternative with blind buffering (faster, but emits tail one chunk later)
- **[indexOf-knuth-morris-pratt](../indexOf-knuth-morris-pratt)** - Alternative using KMP algorithm (for benchmarking comparison, demonstrating JS overhead vs brute-force)

## Stopping at a match

This strategy implements `SearchStrategy<TState>`, reporting to a `MatchSink`. A `finally` block keeps what hasn't been reported in `state`, however the scan ends:

```typescript
processChunk(haystack: string, state: LoopedIndexOfCancellableSearchState, sink: MatchSink): undefined {
  try {
    sink.reportText("...");
    if (!sink.reportMatch(this.needle, [startIndex, endIndex])) return;
  } finally {
    state.buffer = /* everything not yet reported */;
  }
}
```

When `sink.reportMatch()` returns `false`, the strategy returns at once and keeps everything after that match in `state`. From there:

1. **Carry on** - `processChunk("", state, sink)` scans the rest, as the async engines do after pausing at a match
2. **Or flush** - `flush(state)` returns the rest as raw text, as engines do once `stopReplacingSignal` aborts

That is what lets [anchor-sequence](../anchor-sequence) compose it: it stops this strategy at its needle and hands the rest to the next sub-strategy.

**Example:**

```typescript
const strategy = new LoopedIndexOfCancellableSearchStrategy("PLACEHOLDER");
const state = strategy.createState();
strategy.processChunk("First PLACEHOLDER and second PLACEHOLDER", state, {
  reportText: (content) => console.log("text", content),
  reportMatch: () => false // stop at the first match
});

strategy.flush(state); // " and second PLACEHOLDER"
```

**When to use this variant:**

- ✅ Composing with the anchor-sequence meta-strategy
- ❌ Callback-based integration (use [looped-indexOf-callback](../../engine-shapes/fused-callback/looped-indexOf))

## Related Strategies

- **[looped-indexOf-callback](../../engine-shapes/fused-callback/looped-indexOf)** - Same algorithm, callback-based execution
- **[looped-indexOf-anchored](../../../../../src/search-strategies/looped-indexOf-anchored)** - Multi-needle "anchors" version, designed for use independently of the [anchor-sequence](../anchor-sequence) meta-strategy
- **[buffered-indexOf-cancellable](../buffered-indexOf-cancellable)** - Blind buffering alternative (simpler, sometimes faster)
- **[indexOf-knuth-morris-pratt](../indexOf-knuth-morris-pratt)** - KMP algorithm (slower than brute-force due to JS overhead)
- **[anchor-sequence](../anchor-sequence)** - Meta-strategy for composing search strategies
