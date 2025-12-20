# Buffered IndexOf Canonical Search Strategy

A simple, efficient two-token search strategy that uses **blind buffering** to handle patterns that may span chunk boundaries. This implementation is based on a [WHATWG canonical example](https://streams.spec.whatwg.org/#example-ts-lipfuzz), updated to use [`String.prototype.indexOf()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/indexOf) rather than [`RegExp.prototype.exec`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec).

> ⚠️ **STATEFUL STRATEGY**: This strategy implements `Transformer<string>` directly and maintains internal mutable state. It **cannot be reused** across multiple streams. Each stream requires a fresh instance.

## Algorithm Overview

The strategy searches for two sequential tokens (typically opening and closing delimiters like `{{` and `}}`).

It uses JavaScript's built-in `indexOf` for fast searching, then employs a "blind buffering" approach to cater for potential cross-chunk matching: always buffer the last `tokens[0].length - 1` characters at boundaries, regardless of their content.

This contrasts with "smart buffering" approaches (like `looped-indexOf`) that only buffer when the suffix matches the needle prefix. Blind buffering is simpler and more efficient, for most use cases.

## How It Works

### 1. Search for Opening Token

When processing a chunk, the strategy first searches for `tokens[0]` using `indexOf`:

```
Tokens: ["{{", "}}"]
Chunk:  "Hello {{world}}"

Step 1: indexOf("{{") → found at position 6
        ↓
┌──────────────────────────────────────┐
│ Chunk: "Hello {{world}}"             │
│               ^^                     │
│               Opening token at pos 6 │
└──────────────────────────────────────┘
```

### 2. Search for Closing Token

After finding the opening token, search continues from that position for `tokens[1]`:

```
Tokens: ["{{", "}}"]
Chunk:  "Hello {{world}}"

Step 2: Search from position 8 for "}}"
        indexOf("}}") → found at position 13

┌──────────────────────────────────────────┐
│ Chunk: "Hello {{world}}"                 │
│               ^^^^^^^^^                  │
│               Match found!               │
│                                          │
│ Result:                                  │
│   - "Hello " → non-match                 │
│   - "{{world}}" → match                  │
└──────────────────────────────────────────┘
```

### 3. Blind Buffering at Chunk Boundaries

When the chunk ends without finding `tokens[0]`, the strategy **blindly buffers** the last `tokens[0].length - 1` characters:

```
Tokens: ["{{", "}}"]
Chunk:  "Hello wor{"

Buffer calculation:
  splitPoint = max(lastIndex, chunk.length - tokens[0].length + 1)
             = max(0, 10 - 2 + 1)
             = max(0, 9)
             = 9

┌───────────────────────────────────────────┐
│ Chunk: "Hello wor{"                       │
│                  ^                        │
│                   Split at position 9     │
│                                           │
│ Output: "Hello wor" (positions 0-8)       │
│ Buffer: "{" (position 9)                  │
└───────────────────────────────────────────┘

State: partialChunk = "{"
```

**Why blind buffering?** The last 1 character (`tokens[0].length - 1`) is buffered because `tokens[0]` has length 2, and the chunk might end with the first character of `{{`. We don't check if `{` could actually be the start of `{{` — we just buffer it blindly for efficiency.

### 4. Combining Buffer with Next Chunk

When the next chunk arrives, it's combined with the buffered content:

```
Previous buffer: "{"
Next chunk:      "{placeholder}}"

Combined: "{{placeholder}}"
          ^^
          Opening token found at position 0

┌──────────────────────────────────────────────┐
│ Buffer: "{"                                  │
│ Chunk:  "{placeholder}}"                     │
│ Search: "{{placeholder}}"                    │
│          ^^^^^^^^^^^^^^^                     │
│         Complete match found!                │
└──────────────────────────────────────────────┘

Result:
  - "{{placeholder}}" → match
  - partialChunk = "" (buffer cleared)
```

### 5. Failed Partial Match

If the buffer doesn't complete a match, it's eventually flushed as non-matching content:

```
Previous buffer: "{"
Next chunk:      "not a match"

Combined: "{not a match"
          ^
          indexOf("{{") → not found

┌──────────────────────────────────────────────┐
│ Buffer: "{"                                  │
│ Chunk:  "not a match"                        │
│ Search: "{not a match"                       │
│                                              │
│ No opening token found in combined text      │
│ Must buffer last 1 character again           │
└──────────────────────────────────────────────┘

Output: "{not a matc" (all except last char)
Buffer: "h" (last 1 character)
```

## State Management

The strategy maintains a single state variable:

```typescript
type BufferedIndexOfCanonicalState = {
  partialChunk: string; // Buffered content from previous chunk
};
```

**State transitions:**

- **Initial:** `partialChunk = ""`
- **Chunk ends without finding `tokens[0]`:** Buffer last `tokens[0].length - 1` characters
- **Opening token found, closing token found:** Clear buffer, emit match
- **Opening token found, closing token not found:** Buffer content after opening token
- **Flush:** Return buffered content (if any remains)

## Performance Characteristics

- **Best case:** O(n) where n is chunk size

  - `indexOf` is highly optimised in modern JavaScript engines
  - No complex prefix checking needed

- **Worst case:** O(n) where n is chunk size

  - Fixed number of `indexOf` calls per chunk (1-2 calls)
  - `indexOf` itself is O(n) in worst case but highly optimised
  - No variable overhead from pattern complexity

- **Memory:** O(tokens[0].length - 1) to O(unbounded)

  - **Minimum buffer**: `tokens[0].length - 1` bytes when no opening token found
  - **Maximum buffer**: Unbounded when opening token found but closing token not yet found
  - Buffer grows to include opening token + all subsequent content until closing token arrives
  - In practice, typically small for well-formed delimiter pairs

- **Simplicity:** Minimal branching, straightforward logic
  - Easier to maintain and debug than smart buffering
  - Predictable performance characteristics

## Comparison with Other Strategies

| Strategy                       | Buffering Approach                   | Performance                            | Complexity |
| ------------------------------ | ------------------------------------ | -------------------------------------- | ---------- |
| **buffered-indexOf-canonical** | Blind (always buffer last N-1 chars) | O(n), very fast                        | Low        |
| looped-indexOf                 | Smart (check suffix matches prefix)  | O(n × k) where k is prefix checks      | Medium     |
| indexOf-knuth-morris-pratt     | KMP algorithm (smart buffering)      | O(n + m), slower JS                    | High       |
| regex                          | Partial regex matching               | O(n × p) where p is pattern complexity | High       |

**When to use buffered-indexOf-canonical:**

- ✅ Simple two-token patterns (delimiters like `{{` and `}}`)
- ✅ Performance-critical paths (minimal overhead)
- ✅ Typical streaming scenarios (chunk boundaries rarely split patterns)
- ❌ Patterns with many repeating characters (consider indexOf-knuth-morris-pratt with KMP, though usually slower)
- ❌ Need for more than 2 tokens (use buffered-indexOf-anchored-callback)

## Variants

This strategy has several execution variants:

- **[buffered-indexOf-callback](../buffered-indexOf-callback)** - Same algorithm, callback-based execution (no generator)
- **[buffered-indexOf-cancellable](../buffered-indexOf-cancellable)** - Same algorithm, generator-based with explicit cancellation
- **[buffered-indexOf-canonical-generator](../buffered-indexOf-canonical-generator)** - Generator-based variant of this strategy
- **[buffered-indexOf-anchored-callback](../buffered-indexOf-anchored-callback)** - Extended version supporting N tokens (not just 2)

All variants use the same blind buffering algorithm described here.
