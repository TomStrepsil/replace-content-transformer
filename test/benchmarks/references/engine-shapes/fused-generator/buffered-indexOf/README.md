# Buffered IndexOf Canonical Generator

A generator-based variant of the [buffered-indexOf-canonical](../../fused-transformer/buffered-indexOf) strategy.

## Algorithm

This strategy uses the same **blind buffering** algorithm as buffered-indexOf-canonical. See the [canonical strategy documentation](../../fused-transformer/buffered-indexOf/README.md) for a detailed explanation of:

- Blind buffering approach (always buffer last `tokens[0].length - 1` characters)
- Two-token sequential matching with `indexOf`
- State management and edge cases
- Performance characteristics

## Execution Pattern

The key difference is the **execution pattern**:

| Variant                                  | Execution        | Interface                |
| ---------------------------------------- | ---------------- | ------------------------ |
| **buffered-indexOf-canonical-generator** | Fused generator  | Yields output strings    |
| buffered-indexOf-canonical               | Direct processor | Custom interface         |
| buffered-indexOf-callback                | Callback         | Callback-based           |

### Generator Pattern

This variant is a fused generator: it takes the replacement function at construction, and `processChunk` yields the output strings, replacements included:

```typescript
*processChunk(chunk: string): Generator<string, void, undefined> {
  yield "text before the match";
  yield this.replacement(match, { matchIndex, streamIndices });
}
```

It is not a `SearchStrategy`, so it runs through none of the engines. It measures what a generator costs when nothing separates search from replacement; compare it with [buffered-indexOf-callback](../../fused-callback/buffered-indexOf), the same fusion through a callback.

## State Management

It holds its own state, so one instance serves one stream:

```typescript
private state: StringBufferState; // { buffer, streamOffset }
```

## Related Strategies

- **[buffered-indexOf-canonical](../../fused-transformer/buffered-indexOf)** - Main documentation for the blind buffering algorithm
- **[buffered-indexOf-callback](../../fused-callback/buffered-indexOf)** - Callback-based variant
- **[buffered-indexOf-cancellable](../../../algorithms/buffered-indexOf-cancellable)** - A `SearchStrategy` that can stop at a match
- **[buffered-indexOf-anchored-callback](../../fused-callback/buffered-indexOf-anchored)** - N-token extension for multiple delimiters
