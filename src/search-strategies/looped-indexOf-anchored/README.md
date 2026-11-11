# Looped IndexOf Anchored Search Strategy

A high-performance search strategy for finding **sequential string patterns (anchor sequences)** using `String.indexOf()` with smart partial matching to avoid unnecessary buffering.

## Algorithm Overview

This strategy efficiently searches for sequences of strings (needles) that must appear in order, separated by any content. For example:

- `['{{', '}}']` matches `{{content}}` or `{{  spaced  }}`
- `['{{', 'name', '}}']` matches `{{name}}` or `{{  name  }}`
- `['<', '!', '--', '-->']` matches `<!--comment-->`

### Smart Partial Matching

This strategy uses **intelligent partial matching** at chunk boundaries — only buffering when there's actually a potential partial match:

```
Needles: ['{{', '}}']
Chunk ends: "Hello {"

Smart check: Does "{" match a prefix of "{{"?
  - Try 1-char suffix "{" vs 1-char prefix "{" → MATCH!
  - Buffer: "{" (only because we detected a partial match)

Next chunk: "{!data}}>tail"
Combined: "{{!data}}>tail"
           ^^
           First needle found → continue matching
```

**No partial match = no buffering:**

```
Chunk ends: "Hello x"

Smart check: Does "x" match a prefix of "{{"?
  - Try 1-char suffix "x" vs 1-char prefix "{" → NO MATCH
  - Buffer: "" (no unnecessary buffering!)
  - Output: "Hello x" immediately
```

This optimization provides **~27% performance improvement** in scenarios with few or no matches compared to blind buffering.

## Implementation Details

It implements `SearchStrategy<TState>`, reporting to a sink that can stop it at any match:

```typescript
processChunk(
  chunk: string,
  state: LoopedIndexOfAnchoredSearchState,
  sink: MatchSink
): undefined {
  // Sequentially searches for each needle in order
  // Only buffers when partial matches detected at boundaries
  // Reports non-matches via sink.reportText() and matches via sink.reportMatch()
}
```

## Sequential Matching Process

The strategy maintains state to track progress through the needle sequence:

```
Needles: ['{{', '!', '}}']
Chunk:   "Text {{!content}} more"

Process:
  1. Find '{{' at position 5 (currentNeedleIndex: 0 → 1)
  2. From position 7, find '!' at position 7 (currentNeedleIndex: 1 → 2)
  3. From position 8, find '}}' at position 15 (currentNeedleIndex: 2 → 0)
  4. Complete match! Report "{{!content}}" as match

┌──────────────────────────────────────────────┐
│ Chunk: "Text {{!content}} more"              │
│              ^^                              │
│              Needle 0                        │
│                ^                             │
│                Needle 1                      │
│                        ^^                    │
│                        Needle 2              │
│                                              │
│ Result: "Text " → non-match                  │
│         "{{!content}}" → match               │
│         " more" → non-match                  │
└──────────────────────────────────────────────┘
```

### Smart Partial Matching at Chunk Boundaries

The key optimization over blind buffering happens when no match is found for the first needle:

```typescript
// When index === -1 and currentNeedleIndex === 0
const unreportedLength = length - position;
for (
  let partialLength = Math.min(currentNeedle.length - 1, unreportedLength);
  partialLength >= 1;
  partialLength--
) {
  const haystackSuffix = haystack.slice(-partialLength);
  const needlePrefix = currentNeedle.slice(0, partialLength);
  if (haystackSuffix === needlePrefix) {
    // Found partial match - report what precedes it, leave the cursor on it
    const beforePartial = haystack.slice(position, -partialLength);
    position = length - partialLength;
    if (beforePartial) {
      sink.reportText(beforePartial);
    }
    return;
  }
}
// No partial match - output everything
```

**Example with 2-character needle:**

```
Needles: ['{{', '}}']
Chunk ends: "Hello world{"

Loop checks:
  1. partialLength = 1: Does "{" === "{"? YES!
     → Output "Hello world", buffer "{"

Needles: ['{{', '}}']
Chunk ends: "Hello world!"

Loop checks:
  1. partialLength = 1: Does "!" === "{"? NO
     → Output "Hello world!", no buffering
```

### Cross-Chunk Matching with Smart Buffering

When a match spans multiple chunks, only necessary content is buffered:

```
Needles: ['{{', '}}']
Chunk 1: "Hello {{"
Chunk 2: "world}}"

Process Chunk 1:
  - Find '{{' at position 6 (currentNeedleIndex: 0 → 1)
  - Cannot find '}}' in remaining content
  - Buffer: "{{" (mid-match, must buffer from first needle)

Process Chunk 2:
  - Combined: "{{world}}"
  - Find '}}' at position 7 (currentNeedleIndex: 1 → 0)
  - Complete match! Report "{{world}}" as match
```

**Compared to blind buffering:**

```
Needles: ['{{', '}}']
Chunk 1: "Hello world"

Buffered Strategy:
  - Always buffers last 1 character: "d"

Looped Strategy:
  - Checks: Does "d" match prefix of "{{"? NO
  - Buffers: "" (nothing)
  - Benefit: Avoids unnecessary buffering and string operations
```

## State Management

The strategy maintains state to track partial matches and needle sequence progress:

```typescript
type LoopedIndexOfAnchoredSearchState = {
  /** Buffer holding partial content that may span chunks */
  buffer: string;
  /** Index of the current needle being matched (0 to needles.length - 1) */
  currentNeedleIndex: number;
};
```

**State behavior:**

- **Initial:** `buffer = ""`, `currentNeedleIndex = 0`
- **First needle not found + no partial:** Output all content, no buffering
- **First needle not found + partial match:** Buffer only the partial match suffix
- **Mid-sequence:** Buffer from first needle onwards until all needles found
- **Complete match:** Reset `currentNeedleIndex` to 0, clear buffer
- **Stop:** when `sink.reportMatch()` returns `false`, the remainder of the current chunk is left in the buffer, for `flush` to return or for `processChunk("")` to carry on from. Engines stop searching a chunk part-way once `stopReplacingSignal` aborts, and emit this buffer as one chunk
- **Flush:** Returns and clears any buffered content

## Buffer limit

A match still incomplete `maxBufferLength` code units (65,536 by default) after its first anchor passes through as text up to there, `onGuardExceeded` is called, and the search restarts right after, from the first anchor. Each later anchor is only searched for within that limit, so the decision depends only on the text, and is the same however the input is split:

```typescript
const strategy = new StringAnchorSearchStrategy(["{{", "}}"], { maxBufferLength: 6 });
// "{{abcdef{{x}}" → "{{abcdef" as text, then "{{x}}" as a match
// "{{ unclosed …" → output resumes once 6 code units from "{{" have arrived
```

So a stray first anchor holds back no more than the limit, and a real match starting after the limit still matches. A match that straddles the cut passes through as text. A limit shorter than the anchors together, under which nothing could match, throws a `RangeError`. See [Buffer limit](../../../README.md#buffer-limit).

## Performance Characteristics

**Compared to BufferedIndexOfAnchoredSearchStrategy:**

| Scenario                      | Performance     | Reason                                                          |
| ----------------------------- | --------------- | --------------------------------------------------------------- |
| No matches                    | **~27% faster** | Avoids unnecessary buffering at every chunk boundary            |
| Sparse matches                | **Faster**      | Most chunks have no partial matches, avoiding buffer operations |
| Dense matches                 | **Similar**     | Both strategies buffer during actual matches                    |
| Partial matches at boundaries | **Similar**     | Both correctly handle cross-chunk matches                       |

## Usage Examples

> [!IMPORTANT]
> Anchors must be non-empty, and at least one is required — both are rejected at construction. `indexOf("")` returns the current position, so an empty anchor would leave the scan cursor where it is and never advance. This also covers [`BalancedPairSearchStrategy`](../balanced-pair/README.md), which delegates its `opening`/`closing` pair to this strategy.

### Two-Token Pattern (Opening/Closing Delimiters)

```typescript
const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
```

### Multi-Token Pattern (3+ Needles)

```typescript
// Match JSX component with specific prop: <Button variant="primary" ... >
const strategy = new LoopedIndexOfAnchoredSearchStrategy([
  "<Button",
  'variant="primary"',
  ">"
]);
```
