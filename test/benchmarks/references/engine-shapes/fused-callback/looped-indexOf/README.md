# Looped IndexOf Callback

A callback-based variant of the [looped-indexOf-cancellable](../../../algorithms/looped-indexOf-cancellable) strategy.

> ⚠️ **STATEFUL STRATEGY**: This strategy maintains internal mutable state and **cannot be reused** across multiple streams. Each stream requires a fresh instance.

## Algorithm

This strategy uses the same **smart buffering** algorithm as looped-indexOf-cancellable. See the [cancellable strategy documentation](../../../algorithms/looped-indexOf-cancellable/README.md) for a detailed explanation of:

- Smart buffering approach (only buffer when suffix matches needle prefix)
- Loop-based prefix validation algorithm
- State management and edge cases
- Performance characteristics

## Execution Pattern

The key difference is the **execution pattern**:

| Variant                     | Execution      | Returns        |
| --------------------------- | -------------- | -------------- |
| **looped-indexOf-callback** | Callback-based | `void`         |
| looped-indexOf-cancellable  | Sink           | `undefined`    |

### Callback Pattern

This variant calls the replacement and an enqueue callback itself, instead of reporting to an engine's `MatchSink`:

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

- **[looped-indexOf-cancellable](../../../algorithms/looped-indexOf-cancellable)** - Main documentation for the smart buffering algorithm
- **[buffered-indexOf-callback](../buffered-indexOf)** - Blind buffering alternative (simpler, sometimes faster)
- **[indexOf-knuth-morris-pratt](../../../algorithms/indexOf-knuth-morris-pratt)** - KMP algorithm (slower than brute-force due to JS overhead)
