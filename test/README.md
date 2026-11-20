# Test support

Shared helpers for the unit and integration tests under `src/`. Check here before writing a new mock or collector.

See also:

- [`benchmarks/harnesses/`](./benchmarks/harnesses/README.md): the common wrapper that lets every search strategy run through the same validation and benchmark scenarios
- [`benchmarks/`](./benchmarks/README.md): performance benchmarks

## Utilities

[`utilities.ts`](./utilities.ts) exports mocks and collectors used across the suite:

| Helper                                                 | Use for                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mockSearchStrategy({ chunk, settled, rest })`         | A `SearchStrategy` that reports `chunk`'s results for every chunk (and `settled`'s from `settle`), and stops at a match as a real one does: a call with `""` carries on, and `flush` returns what's left plus `rest`. `counts.pulled` counts the results reported. A step can be a callback, run at that point of the scan |
| `mockSearchStrategyFactory(...results)`                | A `mockSearchStrategy` that reports the given results for every chunk, for engine tests                                                                                                                                                                                                                                    |
| `abortingOnFirstCall(controller, result)`              | A replacement mock that aborts `controller` on its first call                                                                                                                                                                                                                                                              |
| `abortErrorCausedBy(reason)`                           | An `AbortError` whose `cause` is `reason`, as Node's `stream.addAbortSignal` fails with                                                                                                                                                                                                                                    |
| `mockSyncEngine()` / `mockAsyncEngine()`               | Engine doubles for adapter unit tests                                                                                                                                                                                                                                                                                      |
| `mockTransformStreamDefaultControllerFactory(outputs)` | A WHATWG controller that pushes enqueued chunks into `outputs`                                                                                                                                                                                                                                                             |
| `collectEngineSink()` / `collectWritable()`            | Capture what an engine or Node stream emits                                                                                                                                                                                                                                                                                |
| `stalledStreamReplacementEngines`                      | Each engine, and `nested()` sources, replacing every `{{…}}` match with a `ReadableStream` that never yields, recording which are cancelled                                                                                                                                                                                |
| `stalledBodyAbortedBy(signal, first)`                  | A body that, like a `fetch` body, yields `first` and then stalls until `signal` aborts, when it errors with the reason                                                                                                                                                                                                     |
| `asyncIterable(...chunks)`, `streamToString(stream)`   | Build and drain async sources                                                                                                                                                                                                                                                                                              |
| `deferred()`                                           | Control promise timing in tests with asynchronous replacements                                                                                                                                                                                                                                                             |
| `createIterableSlotNode(...)`                          | Slot-tree node skeletons for concurrency strategy tests                                                                                                                                                                                                                                                                    |
| `startTestHttpServer(handlers)`                        | A local HTTP server that works on Node, Bun and Deno                                                                                                                                                                                                                                                                       |
| `byteReplacementEngines`                               | Each engine, built to replace `{{…}}` matches with a replacement that may return bytes, for `describe.each`                                                                                                                                                                                                                |
| `guardedEngines`                                       | Each engine, built to upper-case `{{…}}` matches, calling a given `onGuardExceeded` past a buffer limit of 6, and to stop replacing on a given `stopReplacingSignal`, for `describe.each`. `earlierMatchOnceStopped` gives what becomes of a match found earlier in the `write()` in which the signal aborts               |
| `guardedSerial(onGuardExceeded, signal?)`              | A `SerialTransformEngine` upper-casing `{{…}}` matches with the same buffer limit                                                                                                                                                                                                                                          |
| `guardedLookahead(onGuardExceeded, replacement)`       | A `LookaheadTransformEngine` replacing `{{…}}` matches with the same buffer limit                                                                                                                                                                                                                                          |
| `lookaheadFailures`                                    | Each way a `guardedLookahead` engine fails with `lookaheadFailure` on `a{{o}}b`, for `describe.each`                                                                                                                                                                                                                       |
| `throwing(error)`                                      | A callback that throws `error`, such as for `onGuardExceeded`                                                                                                                                                                                                                                                              |

## Driving a search strategy

[`search-strategy-results.ts`](./search-strategy-results.ts) drives a `SearchStrategy` directly, without an engine:

- `collectSearchStrategyResults(strategy, chunks)` runs every chunk, then settles what the strategy still holds (`settle`, or `flush` when it has none). Its `output` must always reproduce the input exactly. It throws if a scan stops advancing, so a runaway loop fails the test instead of exhausting memory.
- `collectCanonicalSearchStrategyResults(strategy, chunks)` merges adjacent non-match text into single segments. Two runs over the same input split differently must produce identical segments.
- `collectStoppedSearchStrategyResults(strategy, chunks, limit)` stops at the `limit`th match, as an engine does once `stopReplacingSignal` aborts, then emits `flush()` and the unwritten chunks. Its `output` must reproduce the input exactly.
- `collectPausedSearchStrategyResults(strategy, chunks)` stops at every match and carries on with `processChunk("")` (or `settle` again), as an engine does when every replacement is asynchronous. Its results must equal an uninterrupted run's.
- `processChunkResults(strategy, haystack, state)` and `settleResults(strategy, state)` collect what one call reports, and `sinkInto(results)` is the `MatchSink` behind them.
- `regexMatchDetailsOf(collected)` reduces the matches in a regex strategy's collected results to plain data (captures, `index`, groups, `indices`, `streamIndices`), so two runs can be compared with `toEqual`.

## Chunk boundaries

Correct behaviour shouldn't depend on where the stream happens to be split. [`splits.ts`](./splits.ts) enumerates the splits to check:

- `everyTwoWaySplit(haystack)`: every two-way split, plus the unsplit input
- `everyThreeWaySplit(haystack)`: every split into three non-empty parts
- `characterBySplit(haystack)`: one character per chunk, the most adversarial case
- `everySplitOf(haystack)`: all of the above, as one list

Combine these with `collectCanonicalSearchStrategyResults` to assert the same matches come out at every split. See `expectSameMatchesAtEverySplit` in [`src/search-strategies/regex/search-strategy.test.ts`](../src/search-strategies/regex/search-strategy.test.ts) for the pattern.
