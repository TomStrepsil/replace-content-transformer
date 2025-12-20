# Buffered IndexOf Canonical Generator

A generator-based variant of the [buffered-indexOf-canonical](../buffered-indexOf-canonical) strategy.

## Algorithm

This strategy uses the same **blind buffering** algorithm as buffered-indexOf-canonical. See the [canonical strategy documentation](../buffered-indexOf-canonical/README.md) for a detailed explanation of:

- Blind buffering approach (always buffer last `tokens[0].length - 1` characters)
- Two-token sequential matching with `indexOf`
- State management and edge cases
- Performance characteristics

## Execution Pattern

The key difference is the **execution pattern**:

| Variant                                  | Execution        | Interface                |
| ---------------------------------------- | ---------------- | ------------------------ |
| **buffered-indexOf-canonical-generator** | Generator        | `SearchStrategy<TState>` |
| buffered-indexOf-canonical               | Direct processor | Custom interface         |
| buffered-indexOf-callback                | Callback         | Callback-based           |

### Generator Pattern

This variant implements the standard `SearchStrategy<TState>` interface:

```typescript
*processChunk(
  chunk: string,
  state: BufferedIndexOfCanonicalGeneratorState
): Generator<MatchResult, void, undefined> {
  yield { content: "...", match: false };
  yield { content: "...", match: true };
}
```

**Benefits of generator-based execution:**

- ✅ **Yield-on-demand** - Consumer controls when to request next result, enabling better flow control
- ✅ **Lazy evaluation** - Only processes as much as needed, not entire chunk at once
- ✅ **Composability** - Can be composed into meta-strategies like [anchor-sequence](../anchor-sequence)
- ✅ **Memory efficient** - Results produced incrementally rather than all at once

## State Management

Uses the same state structure as the canonical variant:

```typescript
type BufferedIndexOfCanonicalGeneratorState = {
  partialChunk: string;
};
```

## Related Strategies

- **[buffered-indexOf-canonical](../buffered-indexOf-canonical)** - Main documentation for the blind buffering algorithm
- **[buffered-indexOf-callback](../buffered-indexOf-callback)** - Callback-based variant
- **[buffered-indexOf-cancellable](../buffered-indexOf-cancellable)** - Generator-based with explicit cancellation
- **[buffered-indexOf-anchored-callback](../buffered-indexOf-anchored-callback)** - N-token extension for multiple delimiters
