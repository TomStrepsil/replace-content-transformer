# Replacement Processors

This directory contains processors that coordinate between search strategies and replacement logic for streaming content transformation. Processors consume matches from search strategies and yield replaced content.

### 🏷️ StaticReplacementProcessor

Replaces all pattern matches with the same static string value. Simplest and fastest replacement option.

- **Replacement Type**: Static string
- **Execution**: Synchronous generator
- **Use Case**: Fixed replacements like `[OLD] → [NEW]`
- **Example**: `new StaticReplacementProcessor({ searchStrategy, replacement: 'NEW' })`

### ⚡ Function Replacement

Replaces matches using a function that receives the matched content and match index. Supports both sync and async replacement functions.

- **Replacement Type**: `(matchedContent: string, index: number) => string | Promise<string>`
- **Execution**: Synchronous generator (can yield promises)
- **Use Case**: Dynamic replacements, transformations, API calls
- **Example**: `new FunctionReplacementProcessor({ searchStrategy, replacement: (match, i) => `[${i}]` })`

### 🔄 Iterable Function Replacement

Replacement function returns an iterable that yields multiple string chunks for a single match. Useful for streaming large replacements or expanding matches into multiple parts.

- **Replacement Type**: `(matchedContent: string, index: number) => Iterable<string>`
- **Execution**: Synchronous generator
- **Use Case**: Expanding matches, streaming large replacements, multi-part substitutions
- **Example**: `new IterableFunctionReplacementProcessor({ searchStrategy, replacement: (match) => ['<', match, '>'] })`

### ⏳ Async Function Replacement

Async version of FunctionReplacementProcessor. Replacement function must return a Promise. Processor awaits each replacement before yielding.

- **Replacement Type**: `(matchedContent: string, index: number) => Promise<string>`
- **Execution**: Async generator
- **Use Case**: API calls, database lookups, async transformations
- **Example**: `new AsyncFunctionReplacementProcessor({ searchStrategy, replacement: async (match) => await fetch(...) })`

### 🌊 Async Iterable Function Replacement

Async version of IterableFunctionReplacementProcessor. Replacement function returns an async iterable that yields chunks asynchronously.

- **Replacement Type**: `(matchedContent: string, index: number) => AsyncIterable<string>`
- **Execution**: Async generator
- **Use Case**: Streaming API responses, async chunk generation
- **Example**: `new AsyncIterableFunctionReplacementProcessor({ searchStrategy, replacement: async function* (match) { yield* streamData() } })`

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
  replacement: (match, index) => `<${index}>`
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

### ⏩ Using FunctionReplacementProcessor with Promises

> [!IMPORTANT]
> This pattern is only compatible with the **WHATWG Streams API** (`ReplaceContentTransformer`). Node.js streams do not support promises as chunk values. For Node.js streams, use `AsyncReplaceContentTransform` instead.

You can use `FunctionReplacementProcessor<Promise<string>>` with async replacement functions instead of `AsyncFunctionReplacementProcessor`. This pattern yields promises immediately without awaiting them, allowing the processor to continue discovering and processing matches in the input stream while async operations are still in flight.

**Key differences:**

- **`FunctionReplacementProcessor<Promise<string>>`** - Initiates all async operations as matches are discovered, yielding promises immediately. Enables parallel processing and early discovery. **Web API only.**
- **`AsyncFunctionReplacementProcessor`** - Awaits each async operation before proceeding to the next match. Ensures serial execution and respects backpressure. **Works with both Web and Node.js.**

**When to use Promise pattern:**

- **Early discovery**: You want to find all matches in the input stream as quickly as possible, without waiting for async operations to complete
- **Parallel processing**: Multiple async operations can run concurrently (e.g., multiple API calls)
- **Consumer control**: The consuming code decides when to await promises

**Trade-offs:**

⚠️ **Bypasses backpressure control** - Async operations are initiated regardless of consumer speed, which can conflict with stream `highWaterMark` settings. If the consumer can't keep up, promises accumulate in memory.

💡 **Consider promise pooling** - Limit concurrent operations by tracking active promises and using `Promise.race()` to wait when a threshold is reached (see main README for example).

**Example (WHATWG Streams):**

```typescript
import { ReplaceContentTransformer } from "replace-content-transformer/web";
import { FunctionReplacementProcessor } from "replace-content-transformer";

// Returns promises immediately, continues processing input
const processor = new FunctionReplacementProcessor<Promise<string>>({
  searchStrategy,
  replacement: async (match) => {
    const result = await fetch(`/api/${match}`);
    return result.text();
  }
});

// Use with generic ReplaceContentTransformer (Web API) to yield promises to stream
const transformer = new ReplaceContentTransformer<Promise<string>>(processor);

// All matches discovered and API calls initiated immediately
const transformedStream = readableStream
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new TransformStream(transformer));

// Consumer can await promises as they arrive
const reader = transformedStream.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  if (value instanceof Promise) {
    const resolved = await value; // Consumer controls when to await
    // ... use resolved
  } else {
    // ... use string value
  }
}
```

**For Node.js Streams:**

```typescript
import { AsyncReplaceContentTransform } from "replace-content-transformer/node";
import { AsyncFunctionReplacementProcessor } from "replace-content-transformer";

// Node.js streams require serial async processing
const transform = new AsyncReplaceContentTransform(
  new AsyncFunctionReplacementProcessor({
    searchStrategy,
    replacement: async (match) => {
      const result = await fetch(`/api/${match}`);
      return result.text();
    }
  })
);

readableStream.pipe(transform).pipe(writableStream);
```

## 📝 Notes

- Processors are designed to work with any search strategy that implements the `SearchStrategy` interface
- All processors maintain match index counting automatically
- Async processors await replacement results before yielding
- The base class handles search state management and flush logic uniformly
