# Buffered IndexOf Anchored Search Strategy (AKA StringAnchorSearchStrategy)

A high-performance search strategy for finding **sequential string patterns (anchor sequences)** using `String.indexOf()` with blind buffering to handle cross-chunk matches.

## Algorithm Overview

This strategy efficiently searches for sequences of strings (needles) that must appear in order, separated by any content. For example:

- `['{{', '}}']` matches `{{content}}` or `{{  spaced  }}`
- `['{{', 'name', '}}']` matches `{{name}}` or `{{  name  }}`
- `['<', '!', '--', '-->']` matches `<!--comment-->`

### Blind Buffering

Unlike the smart buffering approach of `LoopedIndexOfAnchoredSearchStrategy`, this strategy uses **blind buffering** of `needles[0].length - 1` characters:

```
Needles: ['{{', '}}']
Chunk ends: "Hello {"

Buffer: "{" (last needles[0].length - 1 = 1 character)

Next chunk: "{!data}}>tail"
Combined: "{{!data}}>tail"
           ^^
           First needle found → continue matching
```

The buffering is "blind" — it doesn't validate if the suffix could actually start a match, just buffers it for efficiency.

## Implementation Details

This is a **generator-based strategy** implementing `SearchStrategy<TState>` with cancellation support:

```typescript
*processChunk(
  chunk: string,
  state: BufferedIndexOfAnchoredSearchState
): Generator<MatchResult, void, undefined> {
  // Sequentially searches for each needle in order
  // Buffers partial matches that span chunk boundaries
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

### Cross-Chunk Matching

When a match spans multiple chunks, the strategy buffers content:

```
Needles: ['{{', '}}']
Chunk 1: "Hello {{"
Chunk 2: "world}}"

Process Chunk 1:
  - Find '{{' at position 6 (currentNeedleIndex: 0 → 1)
  - Cannot find '}}' in remaining content
  - Buffer: "{{" (partial match in progress)

Process Chunk 2:
  - Combined: "{{world}}"
  - Find '}}' at position 7 (currentNeedleIndex: 1 → 0)
  - Complete match! Yield "{{world}}" as match
```

## State Management

The strategy maintains state to track partial matches and needle sequence progress:

```typescript
type BufferedIndexOfAnchoredSearchState = {
  /** Buffer holding partial content that may span chunks */
  buffer: string;
  /** Index of the current needle being matched (0 to needles.length - 1) */
  currentNeedleIndex: number;
};
```

**State behavior:**

- **Initial:** `buffer = ""`, `currentNeedleIndex = 0`
- **First needle not found:** Buffer last `needles[0].length - 1` characters (blind buffering)
- **Mid-sequence:** Buffer from first needle onwards until all needles found
- **Complete match:** Reset `currentNeedleIndex` to 0, clear buffer
- **Cancel:** if consuming processor breaks iteration, remainder of current chunk pushed to flush buffer
- **Flush:** Returns and clears any buffered content

## Usage Examples

### Two-Token Pattern (Opening/Closing Delimiters)

```typescript
import { StringAnchorSearchStrategy } from "replace-content-transformer";

const strategy = new StringAnchorSearchStrategy(["{{", "}}"]);
```

### Multi-Token Pattern (3+ Needles)

```typescript
// Match JSX component with specific prop: <Button variant="primary" ... >
const strategy = new StringAnchorSearchStrategy([
  "<Button",
  'variant="primary"',
  ">"
]);
```
