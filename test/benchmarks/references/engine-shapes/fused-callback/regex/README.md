# Regex Callback

A callback-based variant of the [regex-canonical](../../fused-transformer/regex) strategy.

> ⚠️ **STATEFUL STRATEGY**: This strategy maintains internal mutable state and **cannot be reused** across multiple streams. Each stream requires a fresh instance.

## Algorithm

This strategy uses the same **regex matching with partial match detection** algorithm as the regex strategy. See the [main regex documentation](../../../../../../src/search-strategies/regex/README.md) for a detailed explanation of:

- Dual regex approach (complete match + partial match patterns)
- `toPartialMatch()` transformation by Lucas Trzesniewski
- State management and buffering behaviour
- Performance characteristics and limitations

## Execution Pattern

The key difference is the **execution pattern**:

| Variant            | Execution      | Returns        |
| ------------------ | -------------- | -------------- |
| **regex-callback** | Callback-based | `void`         |
| regex              | Sink           | `undefined`    |

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
- `openRegex: RegExp` - The pattern to match
- `partialAtEndRegex: RegExp` - Pattern for detecting incomplete matches at chunk boundaries

## Related Strategies

- **[regex](../../../../../../src/search-strategies/regex)** - Main documentation for regex matching with partial detection
- **[regex-canonical](../../fused-transformer/regex)** - Based on WHATWG canonical example
