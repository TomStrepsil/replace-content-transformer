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

This is a **generator-based strategy** implementing `SearchStrategy<TState>` with cancellation support:

```typescript
*processChunk(
  chunk: string,
  state: LoopedIndexOfAnchoredSearchState
): Generator<MatchResult, void, undefined> {
  // Sequentially searches for each needle in order
  // Only buffers when partial matches detected at boundaries
  // Yields matches and non-matches
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
  4. Complete match! Yield "{{!content}}" as match

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
const remainder = haystack.slice(position);
for (
  let partialLength = currentNeedle.length - 1;
  partialLength >= 1;
  partialLength--
) {
  const haystackSuffix = remainder.slice(-partialLength);
  const needlePrefix = currentNeedle.slice(0, partialLength);
  if (haystackSuffix === needlePrefix) {
    // Found partial match - buffer it
    yield { content: remainder.slice(0, -partialLength), match: false };
    state.buffer = haystackSuffix;
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
  - Complete match! Yield "{{world}}" as match
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
- **Cancel:** if consuming processor breaks iteration, remainder of current chunk pushed to flush buffer
- **Flush:** Returns and clears any buffered content

## Performance Characteristics

**Compared to BufferedIndexOfAnchoredSearchStrategy:**

| Scenario                      | Performance     | Reason                                                          |
| ----------------------------- | --------------- | --------------------------------------------------------------- |
| No matches                    | **~27% faster** | Avoids unnecessary buffering at every chunk boundary            |
| Sparse matches                | **Faster**      | Most chunks have no partial matches, avoiding buffer operations |
| Dense matches                 | **Similar**     | Both strategies buffer during actual matches                    |
| Partial matches at boundaries | **Similar**     | Both correctly handle cross-chunk matches                       |

## Usage Examples

### Two-Token Pattern (Opening/Closing Delimiters)

```typescript
import { LoopedIndexOfAnchoredSearchStrategy } from "replace-content-transformer";

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
