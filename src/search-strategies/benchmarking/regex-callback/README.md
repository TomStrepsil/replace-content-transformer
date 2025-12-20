# Regex Callback

A callback-based variant of the [regex-canonical](../regex-canonical) strategy.

> ⚠️ **STATEFUL STRATEGY**: This strategy maintains internal mutable state and **cannot be reused** across multiple streams. Each stream requires a fresh instance.

## Algorithm

This strategy uses the same **regex matching with partial match detection** algorithm as the regex strategy. See the [main regex documentation](../regex/README.md) for a detailed explanation of:

- Dual regex approach (complete match + partial match patterns)
- `toPartialMatch()` transformation by Lucas Trzesniewski
- State management and buffering behaviour
- Performance characteristics and limitations

## Execution Pattern

The key difference is the **execution pattern**:

| Variant            | Execution      | Returns        |
| ------------------ | -------------- | -------------- |
| **regex-callback** | Callback-based | `void`         |
| regex              | Generator      | Yields results |

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
- `openRegex: RegExp` - The pattern to match
- `partialAtEndRegex: RegExp` - Pattern for detecting incomplete matches at chunk boundaries

## Related Strategies

- **[regex](../regex)** - Main documentation for regex matching with partial detection
- **[regex-cancellable](../regex-cancellable)** - Generator-based with explicit cancellation
- **[regex-canonical](../regex-canonical)** - Based on WHATWG canonical example
