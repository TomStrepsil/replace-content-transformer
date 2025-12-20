# Buffered IndexOf Callback

A callback-based variant of the [buffered-indexOf-canonical](../buffered-indexOf-canonical) strategy.

> ⚠️ **STATEFUL STRATEGY**: This strategy maintains internal mutable state and **cannot be reused** across multiple streams. Each stream requires a fresh instance.

## Algorithm

This strategy uses the same **blind buffering** algorithm as buffered-indexOf-canonical. See the [canonical strategy documentation](../buffered-indexOf-canonical/README.md) for a detailed explanation of:

- Blind buffering approach (always buffer last `tokens[0].length - 1` characters)
- Two-token sequential matching with `indexOf`
- State management and edge cases
- Performance characteristics

## Execution Pattern

The key difference is the **execution pattern**:

| Variant                       | Execution        | Returns        |
| ----------------------------- | ---------------- | -------------- |
| **buffered-indexOf-callback** | Callback-based   | `void`         |
| buffered-indexOf-canonical    | Direct processor | Yields results |

### Callback Pattern

This variant uses a callback function to emit output instead of yielding results:

```typescript
processor.enqueue({
  content: matchedText,
  match: true
});
```

## State Management

This is a class-based callback strategy with instance properties:

- `partialChunk: string` - Content buffered from previous chunk
- `lastIndex: number | undefined` - Position in current chunk after last operation
- `matchIndex: number` - Counter for completed matches (used for replacement function index)
- `tokens: string[]` - The opening and closing delimiters to match

## Related Strategies

- **[buffered-indexOf-canonical](../buffered-indexOf-canonical)** - Main documentation for the blind buffering algorithm
- **[buffered-indexOf-cancellable](../buffered-indexOf-cancellable)** - Generator-based with explicit cancellation
- **[buffered-indexOf-canonical-generator](../buffered-indexOf-canonical-generator)** - Generator-based variant
- **[buffered-indexOf-anchored-callback](../buffered-indexOf-anchored-callback)** - N-token extension (not limited to 2 tokens)
