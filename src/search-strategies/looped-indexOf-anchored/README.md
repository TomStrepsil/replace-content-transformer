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

This is a **generator-based strategy** implementing `SearchStrategy<TState>`. Positions are stream offsets, and the content not yet reported is held in a `HeldText`, which keeps each chunk as received rather than joining it onto what is already held:

```typescript
*processChunk(
  chunk: string,
  state: LoopedIndexOfAnchoredSearchState
): Generator<MatchResult, void, undefined> {
  // Appends the chunk, then finds each anchor in order from the match's start
  // Only holds back a tail that could begin the first anchor, or a match in progress
  // Yields matches and non-matches
}
```

## Sequential Matching Process

From the next possible start, the strategy finds the first anchor, then each later anchor from where the previous one ended:

```
Needles: ['{{', '!', '}}']
Chunk:   "Text {{!content}} more"

Process:
  1. Find '{{' at position 5
  2. From position 7, find '!' at position 7
  3. From position 8, find '}}' at position 15
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

When the first anchor is not found, everything is reported except the longest tail that could begin it:

```
Needles: ['{{', '}}']
Chunk ends: "Hello world{"
  → Output "Hello world", hold "{"

Chunk ends: "Hello world!"
  → Output "Hello world!", hold nothing
```

### Cross-Chunk Matching

When a match spans chunks, it is held from its first anchor until it completes:

```
Needles: ['{{', '}}']
Chunk 1: "Hello {{"
Chunk 2: "world}}"

Process Chunk 1:
  - Find '{{' at position 6
  - Cannot find '}}' yet
  - Output "Hello ", hold "{{"

Process Chunk 2:
  - Find '}}' at position 13, searching only content '}}' could end in
  - Complete match! Yield "{{world}}" as match
```

Each anchor's search resumes where its last search left off, so a match held across many chunks costs time linear in its length: no content is searched or copied twice while it waits.

## Buffer Guard

A match longer than `maxBufferLength` (65,536 code units by default) never matches. Its first anchor passes through as text, and the search resumes one code unit after it, so a later first anchor inside the held span is still found:

```typescript
const strategy = new StringAnchorSearchStrategy(["{{", "}}"], {
  maxBufferLength: 8
});
// "a{{1234}}b"  → "a", match "{{1234}}", "b"  (8 code units: at the limit)
// "a{{12345}}b" → "a{{12345}}b"               (9: passes through)
// "{{ab{{c}}d"  → "{{ab", match "{{c}}", "d"  ("{{ab{{c}}" is 9)
// "{{" + 1 MiB with no "}}" → passed through once more than 8 code units are held
```

The rule depends on a match's length, not on where chunks fall, so results are the same however the input is split. `onGuardExceeded` is called once for each candidate given up on. See [Buffering and the guard](../../../README.md#buffering-and-the-guard).

## State Management

```typescript
type LoopedIndexOfAnchoredSearchState = {
  /** Content received but not yet reported. */
  held: HeldText;
  /** Stream position at or after which the next match may start. */
  candidateFrom: number;
};
```

**State behavior:**

- **First anchor not found:** report everything but a tail that could begin it
- **Match in progress:** hold from its first anchor, until it completes or exceeds `maxBufferLength`
- **Complete match:** report it, and search on from its end
- **Cancel:** if the consumer stops iterating, whatever was not yet yielded stays held for `flush`. Engines stop searching a chunk part-way once `stopReplacingSignal` aborts, and emit what is held as one chunk
- **Flush:** returns what is held, and re-sets the state

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
> Anchors must be non-empty, and at least one is required — both are rejected at construction. `indexOf("")` returns the current position, so an empty anchor would leave the scan cursor where it is and never advance. [`BalancedPairSearchStrategy`](../balanced-pair/README.md) applies the same check to its `opening`/`closing` pair.

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
