# Buffered IndexOf Anchored Callback

An extension of the [buffered-indexOf-canonical](../buffered-indexOf-canonical) strategy that supports **N delimiters** (not limited to 2 tokens).

> ⚠️ **STATEFUL STRATEGY**: This strategy maintains internal mutable state and **cannot be reused** across multiple streams. Each stream requires a fresh instance.

## Algorithm

This strategy extends the **blind buffering** algorithm from buffered-indexOf-canonical to handle multiple sequential delimiters. For the core blind buffering approach, see the [canonical strategy documentation](../buffered-indexOf-canonical/README.md).

## Key Differences from Canonical

| Feature         | buffered-indexOf-canonical    | buffered-indexOf-anchored-callback |
| --------------- | ----------------------------- | ---------------------------------- |
| **Token Count** | Exactly 2 (opening + closing) | N tokens (2 or more)               |
| **Execution**   | Direct processor              | Callback-based                     |
| **Use Case**    | Simple delimiter pairs        | Multi-delimiter patterns           |

## How It Works

### Sequential Multi-Delimiter Matching

Instead of just two tokens (`opening` and `closing`), this strategy matches a sequence of N delimiters:

```
Delimiters: ["{{", "!", "}}", ">"]
Chunk:      "Text {{!content}}>more"

Process:
  1. Find "{{" at position 5
  2. From position 7, find "!" at position 7
  3. From position 8, find "}}" at position 15
  4. From position 17, find ">" at position 17

┌──────────────────────────────────────────────┐
│ Chunk: "Text {{!content}}>more"              │
│              ^^                              │
│              Delimiter 0                     │
│                ^                             │
│                Delimiter 1                   │
│                        ^^                    │
│                        Delimiter 2           │
│                          ^                   │
│                          Delimiter 3         │
│                                              │
│ Result: "Text " → non-match                  │
│         "{{!content}}>" → match              │
│         "more" → non-match                   │
└──────────────────────────────────────────────┘
```

### Blind Buffering with First Delimiter

Like the canonical strategy, this variant uses **blind buffering** based on `delimiters[0].length - 1`:

```
Delimiters: ["{{", "!", "}}", ">"]
Chunk ends: "Hello {"

Buffer: "{" (last delimiters[0].length - 1 = 1 character)

Next chunk: "{!data}}>tail"
Combined: "{{!data}}>tail"
           ^^
           First delimiter found → continue matching
```

The buffering is "blind" — it doesn't check if `{` could actually be the start of `{{`, just buffers it for efficiency.

### Partial Match State

When delimiters are found but the sequence isn't complete, the strategy buffers content:

```
Delimiters: ["{{", "!", "}}", ">"]
Chunk 1:    "{{!partial"

Process:
  - Find "{{" at 0
  - Find "!" at 2
  - Search for "}}" → not found
  - Buffer: "{{!partial" (waiting for "}}" and ">")

Chunk 2:    "}}>"
Combined:   "{{!partial}}>"
  - Find "}}" at 10
  - Find ">" at 12
  - Complete match!
```

## State Management

This is a **callback-based strategy** that maintains state as instance properties (not a separate state object):

```typescript
class BufferedIndexOfAnchoredCallbackSearchStrategy {
  private partialChunk: string; // Buffered content from previous chunk
  private matchIndex: number; // Counter for completed matches (not delimiter progress)
  private readonly delimiters: string[];
}
```

**State behavior:**

- **Initial:** `partialChunk = ""`
- **First delimiter not found:** Buffer last `delimiters[0].length - 1` characters
- **All delimiters found:** Clear buffer, emit match via callback, increment `matchIndex`
- **Some delimiters found:** Buffer from first delimiter onwards (unbounded until sequence completes)
- **Flush:** Return any buffered content

## Edge Cases

### Incomplete Delimiter Sequence

```
Delimiters: ["{{", "!", "}}", ">"]
Chunk:      "{{!no closing"

Result:
  - Buffer: "{{!no closing"

Next chunk: " markers here"
  - Cannot find "}}" in combined text
  - Flush "{{!no closing marker" as non-match
  - Buffer "s here" (blind buffering)
```

### Multiple Matches

```
Delimiters: ["{{", "!", "}}", ">"]
Chunk:      "{{!first}}> and {{!second}}>"

Process:
  1. Match "{{!first}}>" (all 4 delimiters)
  2. Continue searching in " and {{!second}}>"
  3. Match "{{!second}}>" (all 4 delimiters)
  4. Result:
     - "{{!first}}>" → match
     - " and " → non-match
     - "{{!second}}>" → match
```

### Cross-Chunk Delimiter Sequence

```
Delimiters: ["{{", "!", "}}", ">"]
Chunk 1:    "{{!"
Chunk 2:    "more}}"
Chunk 3:    ">"

Process:
  Chunk 1: Found "{{" and "!" → buffer "{{!"
  Chunk 2: Combined "{{!more}}" → found "}}" → buffer "{{!more}}"
  Chunk 3: Combined "{{!more}}>" → found ">" → complete match!
```

## Callback Execution Pattern

This strategy uses callbacks instead of generators:

```typescript
processor.enqueue({
  content: matchedText,
  match: true
});
```

**When to use buffered-indexOf-anchored-callback:**

- ✅ Multi-delimiter patterns (3+ tokens)
- ✅ Sequential delimiter matching
- ✅ Callback-based integration
- ✅ Extension of blind buffering approach
- ❌ Need generator control flow (consider implementing generator variant)
- ❌ Only 2 tokens (use buffered-indexOf-canonical for simplicity)

## Performance Characteristics

- **Best case:** O(n) where n is chunk size

  - Sequential `indexOf` calls for each delimiter
  - Blind buffering avoids prefix checking overhead

- **Worst case:** O(n × d) where d is number of delimiters

  - Each delimiter requires an `indexOf` call
  - Still efficient for small delimiter counts (2-4)

- **Memory:** O(delimiters[0].length - 1 + partial match size)
  - Minimal fixed overhead from blind buffering
  - Variable overhead from partial matches spanning chunks

## Related Strategies

- **[buffered-indexOf-canonical](../buffered-indexOf-canonical)** - Core blind buffering algorithm (2 tokens only)
- **[buffered-indexOf-callback](../buffered-indexOf-callback)** - Callback-based 2-token variant
- **[anchor-sequence](../anchor-sequence)** - Meta-strategy for composing multiple search strategies
