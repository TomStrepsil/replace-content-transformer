# Regex Canonical

A variant of the [regex](../regex) strategy based on the [WHATWG Streams specification canonical example](https://streams.spec.whatwg.org/#example-ts-lipfuzz).

> ⚠️ **STATEFUL STRATEGY**: This strategy implements `Transformer<string>` directly and maintains internal mutable state. It **cannot be reused** across multiple streams. Each stream requires a fresh instance.

## Algorithm

This strategy uses the same **regex matching with partial match detection** algorithm as the regex strategy. See the [main regex documentation](../regex/README.md) for a detailed explanation of:

- Dual regex approach (complete match + partial match patterns)
- `toPartialMatch()` transformation by Lucas Trzesniewski
- State management and buffering behaviour
- Performance characteristics and limitations

## Origin: WHATWG "LipFuzz" Example

This strategy is inspired by the ["LipFuzz" transformer example](https://streams.spec.whatwg.org/#example-ts-lipfuzz) from the WHATWG Streams specification, which demonstrates how to transform stream content while handling patterns that span chunk boundaries.

The original example used moustache-style delimiters (`{{` and `}}`). This implementation extends the concept to support arbitrary regex patterns with partial matching.

## Key Differences from Main Regex Strategy

| Feature             | regex                  | regex-canonical                   |
| ------------------- | ---------------------- | --------------------------------- |
| **Origin**          | Generic implementation | Based on WHATWG spec example      |
| **Use Case**        | General regex matching | Exemplar/reference implementation |
| **Pattern Support** | Single regex pattern   | Two-token delimiter patterns      |

## Execution Pattern

This is a **direct processor** implementation (not a callback or standard generator):

```typescript
// Processes chunks directly
processor.processChunk(chunk, state);
```

## Relationship to Specification

The WHATWG Streams specification uses this pattern as a canonical example of:

1. Handling patterns that span chunk boundaries
2. Buffering minimal content to detect matches
3. Using partial matching to minimise buffering

This implementation maintains that spirit while extending to arbitrary regex patterns.

## State Management

Uses the same state structure as the main regex strategy:

```typescript
type RegexCanonicalState = {
  partialChunk: string; // Buffered content from partial match
};
```

## Related Strategies

- **[regex](../regex)** - Main documentation for regex matching with partial detection
- **[regex-callback](../regex-callback)** - Callback-based variant
- **[regex-cancellable](../regex-cancellable)** - Generator-based with explicit cancellation
- **[buffered-indexOf-canonical](../buffered-indexOf-canonical)** - WHATWG example using indexOf instead of regex
