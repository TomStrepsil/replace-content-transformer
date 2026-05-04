# Replacement Processors

This directory contains processors that coordinate between search strategies and replacement logic for streaming content transformation. Processors consume matches from search strategies and yield replaced content.

### 🏷️ StaticReplacementProcessor

Replaces all pattern matches with the same static string value. Simplest and fastest replacement option.

- **Replacement Type**: Static string
- **Execution**: Synchronous generator
- **Use Case**: Fixed replacements like `[OLD] → [NEW]`
- **Example**: `new StaticReplacementProcessor({ searchStrategy, replacement: 'NEW' })`

### ⚡ Function Replacement

Replaces matches using a function that receives the matched content and a context object. Supports both sync and async replacement functions.

- **Replacement Type**: `(match: TMatch, context: ReplacementContext) => string | Promise<string>`
- **Execution**: Synchronous generator (can yield promises)
- **Use Case**: Dynamic replacements, transformations, API calls
- **Example**: `new FunctionReplacementProcessor({ searchStrategy, replacement: (match, { matchIndex }) => `[${matchIndex}]` })`

For async replacement work, use `AsyncFunctionReplacementProcessor` (serial) or the pipelined [`LookaheadAsyncIterableTransformer`](../lookahead/README.md) (concurrent, in-order output, pluggable scheduling).

### 🔄 Iterable Function Replacement

Replacement function returns an iterable that yields multiple string chunks for a single match. Useful for streaming large replacements or expanding matches into multiple parts.

- **Replacement Type**: `(match: TMatch, context: ReplacementContext) => Iterable<string>`
- **Execution**: Synchronous generator
- **Use Case**: Expanding matches, streaming large replacements, multi-part substitutions
- **Example**: `new IterableFunctionReplacementProcessor({ searchStrategy, replacement: (match, { matchIndex }) => ['<', match, '>', `(${matchIndex})`] })`

### ⏳ Async Function Replacement

Async version of FunctionReplacementProcessor. Replacement function must return a Promise. Processor awaits each replacement before yielding.

- **Replacement Type**: `(match: TMatch, context: ReplacementContext) => Promise<string>`
- **Execution**: Async generator
- **Use Case**: API calls, database lookups, async transformations
- **Example**: `new AsyncFunctionReplacementProcessor({ searchStrategy, replacement: async (match, { matchIndex }) => await fetch(`/api/${matchIndex}`) })`

### 🌊 Async Iterable Function Replacement

Async version of IterableFunctionReplacementProcessor. Replacement function returns an async iterable that yields chunks asynchronously.

- **Replacement Type**: `(match: TMatch, context: ReplacementContext) => AsyncIterable<string>`
- **Execution**: Async generator
- **Use Case**: Streaming API responses, async chunk generation
- **Example**: `new AsyncIterableFunctionReplacementProcessor({ searchStrategy, replacement: async function* (match, { matchIndex }) { yield* streamData(matchIndex) } })`

## 🏗️ Architecture

All processors extend `ReplacementProcessorBase` which:

- Manages search strategy state
- Delegates pattern matching to search strategies
- Handles the `flush()` method for remaining buffered content
- Provides the core `processChunk()` → yield loop

Processors implement either:

- **`SyncProcessor`** - Synchronous generator: `Generator<string, void, undefined>`
- **`AsyncProcessor`** - Async generator: `AsyncGenerator<string, void, undefined>`

## 🛠️ Usage Pattern

```typescript
import { FunctionReplacementProcessor } from "./replacement-processors";
import { StringAnchorSearchStrategy } from "./search-strategies";

// 1. Create search strategy
const searchStrategy = new StringAnchorSearchStrategy(["[", "]"]);

// 2. Create processor with replacement logic
const processor = new FunctionReplacementProcessor({
  searchStrategy,
  replacement: (match, { matchIndex }) => `<${matchIndex}>`
});

// 3. Process chunks
for (const chunk of inputChunks) {
  for (const output of processor.processChunk(chunk)) {
    // output is either non-matched content or replacement result
  }
}

// 4. Flush remaining content
const remaining = processor.flush();
```

## 🤔 Choosing a Processor

| Requirement                       | Processor                                   |
| --------------------------------- | ------------------------------------------- |
| Same replacement every time       | `StaticReplacementProcessor`                |
| Dynamic replacement (sync)        | `FunctionReplacementProcessor`              |
| Dynamic replacement (async)       | `AsyncFunctionReplacementProcessor`         |
| Multiple chunks per match (sync)  | `IterableFunctionReplacementProcessor`      |
| Multiple chunks per match (async) | `AsyncIterableFunctionReplacementProcessor` |

### ⏩ Pipelined async: `LookaheadAsyncIterableTransformer`

For async replacement work that benefits from discovering later matches while earlier replacements are still in flight — with **in-order output** and **bounded concurrency** — use the [`LookaheadAsyncIterableTransformer`](../../README.md#pipelined-async-replacement-with-lookaheadasynciterabletransformer). It supersedes the previous `FunctionReplacementProcessor<Promise<string>>` pattern, which initiated async work without any concurrency control.

## 📝 Notes

- Processors are designed to work with any search strategy that implements the `SearchStrategy` interface
- All processors maintain match index counting automatically
- Async processors await replacement results before yielding
- The base class handles search state management and flush logic uniformly
