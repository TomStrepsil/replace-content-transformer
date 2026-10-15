# Test support

Shared helpers for the unit and integration tests under `src/`. Check here before writing a new mock or collector.

See also:

- [`harnesses/`](./harnesses/README.md): the common wrapper that lets every search strategy run through the same validation and benchmark scenarios
- [`benchmarks/`](./benchmarks/README.md): performance benchmarks

## Utilities

[`utilities.ts`](./utilities.ts) exports mocks and collectors used across the suite:

| Helper                                                 | Use for                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `mockSearchStrategyFactory(...results)`                | A `SearchStrategy` whose `processChunk` yields the given results, for engine tests |
| `flushesText(...contents)`                             | A `flush()` implementation for a mocked strategy                                   |
| `mockSyncEngine()` / `mockAsyncEngine()`               | Engine doubles for adapter unit tests                                              |
| `mockTransformStreamDefaultControllerFactory(outputs)` | A WHATWG controller that pushes enqueued chunks into `outputs`                     |
| `collectEngineSink()` / `collectWritable()`            | Capture what an engine or Node stream emits                                        |
| `asyncIterable(...chunks)`, `streamToString(stream)`   | Build and drain async sources                                                      |
| `deferred()`, `settleMicrotasks(times)`                | Control promise timing in async engine tests                                       |
| `createIterableSlotNode(...)`                          | Slot-tree node skeletons for concurrency strategy tests                            |
| `startTestHttpServer(handlers)`                        | A local HTTP server that works on Node, Bun and Deno                               |

## Driving a search strategy

[`search-strategy-results.ts`](./search-strategy-results.ts) drives a `SearchStrategy` directly, without an engine:

- `collectSearchStrategyResults(strategy, chunks)` runs every chunk plus the final `flush()`. Its `output` must always reproduce the input exactly. It throws if a scan stops advancing, so a runaway loop fails the test instead of exhausting memory.
- `collectCanonicalSearchStrategyResults(strategy, chunks)` merges adjacent non-match text into single segments. Two runs over the same input split differently must produce identical segments.
- `flushToString(strategy, state)` returns what a strategy is still holding.
- `regexMatchDetailsOf(collected)` reduces the matches in a regex strategy's collected results to plain data (captures, `index`, groups, `indices`, `streamIndices`), so two runs can be compared with `toEqual`.

## Chunk boundaries

Correct behaviour shouldn't depend on where the stream happens to be split. [`splits.ts`](./splits.ts) enumerates the splits to check:

- `everyTwoWaySplit(haystack)`: every two-way split, plus the unsplit input
- `everyThreeWaySplit(haystack)`: every split into three non-empty parts
- `characterBySplit(haystack)`: one character per chunk, the most adversarial case
- `everySplitOf(haystack)`: all of the above, as one list

Combine these with `collectCanonicalSearchStrategyResults` to assert the same matches come out at every split. See `expectSameMatchesAtEverySplit` in [`src/search-strategies/regex/search-strategy.test.ts`](../src/search-strategies/regex/search-strategy.test.ts) for the pattern.
