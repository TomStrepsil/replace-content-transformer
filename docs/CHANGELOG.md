# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING:** Replacement callbacks now receive `match` as the first parameter and `context` as the second: `(match, context: ReplacementContext) => ...`
- **BREAKING:** Made Node minimum version 22 (LTS)
  - support for `import.meta.dirname` required Node 20+, and the project baseline was aligned to Node 22 LTS, to allow use of [`Promise.withResolvers`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers)
- **BREAKING:** `FunctionReplacementProcessor` no longer accepts a `Promise<string>` replacement type; its replacement function must now return `string`. The previous pattern of enqueuing promises onto the stream for downstream `await` has been superseded by `LookaheadAsyncIterableTransformer`, which provides pipelined async replacement with in-order output and bounded concurrency. Consequently:
  - `FunctionReplacementProcessor` drops its third `R extends string | Promise<string>` type parameter.
  - `ReplaceContentTransformer` drops its `T extends string | Promise<string>` type parameter; output is always `string`.
  - `SyncProcessor` drops its `T` type parameter.
  - Migration: replace `new ReplaceContentTransformer<Promise<string>>(new FunctionReplacementProcessor<Promise<string>>({...}))` with `new LookaheadAsyncIterableTransformer({...})` imported from `replace-content-transformer/web`.
- Updated `regex-partial-match` to [v0.3.0](https://github.com/TomStrepsil/regex-partial-match/releases/tag/v0.3.0)
- Updated eslint config to use [`projectService`](https://typescript-eslint.io/blog/project-service/) for improved typescript integration
- Switched internal imports to explicit `.js` specifiers for better ESM/type export compatibility
- Updated `vitest` to [version 4.1.5](https://github.com/vitest-dev/vitest/releases/tag/v4.1.5)
- Removed [`msw`](https://github.com/mswjs/msw/) dependency

### Added

- A `"codemods"` workspace, plus a `jscodeshift` codemod and an npm script in the workspace to migrate replacement callbacks from positional arguments to `(match, context)` form
- `bench:compare-runtimes` package script, enacting the `runtime/compare.ts` script previously undocumented
- Updated benchmark search strategies to include proper stream indices, to support parity of functionality
- Explicit CJS build step / exports, and add [`@arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io) validation
- Note regarding `matchIndex` / `streamIndices` in recursive scenarios to [`README.md`](../README.md)
- Ensured CI validates Bun & Deno as well as Node in CI, as was suggested in main [`README.md`](../README.md) already
  - Added lock files for Deno and Bun, to support this
- Added a version to `packageManager` in `package.json`
- Added a hand-rolled http test server utility, compatible with Bun / Deno / Node, to replace [`msw`](https://github.com/mswjs/msw/)
  - Added temporary opt-out of test using complement set intersection of regex character classes due to Bun bug (https://github.com/oven-sh/bun/issues/30183)
- Added proper cross-runtime matrix for CI tests, as promised in the main [`README.md`](../README.md)
- `LookaheadAsyncIterableTransformer` — a WHATWG `Transformer<string, string>` that scans streaming input for matches and, rather than serially awaiting each replacement before looking for the next, **eagerly initiates** replacement work as matches are discovered. Downstream output order is preserved (earlier matches' chunks always emit before later matches'), while concurrent initiation of async iterable replacements unlocks pipelined I/O (e.g. parallel fragment fetches with in-order rendering)
- `nested(source)` sentinel for opt-in recursive re-scanning: returning `nested(body)` from a replacement function signals that the parent transformer should spawn a child (sharing the same search strategy, concurrency strategy, and replacement function) to re-process the body; a plain `AsyncIterable<string>` return emits the body verbatim. Nested work competes for the same concurrency budget and is ordered across nesting levels by tree-aware comparators
- Pluggable `ConcurrencyStrategy` interface with two built-in implementations:
  - `SemaphoreStrategy` — FIFO arrival-order dispatch bounded by a concurrency limit (use `SemaphoreStrategy(Infinity)` explicitly for unfettered dispatch)
  - `PriorityQueueStrategy` — heap-backed, slot-tree-aware, pairs with a `NodeComparator` to order queued work across nesting levels
- Two built-in comparators for `PriorityQueueStrategy`: `streamOrder` (earlier-in-output-stream first, via LCA) and `breadthFirst` (shallower first, siblingIndex tie-break)
- Supporting types exposed for custom `ConcurrencyStrategy` implementations: `IterableSlotNode`, `TextSlotNode`, `SlotNode`, `NodeComparator`
- `highWaterMark` option on `LookaheadAsyncIterableTransformer` (default `32`) — caps the number of slots the scanner may buffer ahead of the drainer, providing upstream backpressure when downstream stalls
- `LookaheadAsyncIterableTransform` — Node `stream.Transform` counterpart exported from `replace-content-transformer/node`. Shares the same engine/options as the web adapter (plus optional `streamHighWaterMark` for the underlying Node-stream high-water mark); supports nested `nested()` re-scanning and all concurrency/comparator primitives identically

### Fixed

- Corrected some paths in docs for the runtime benchmarks
- Corrected JSDoc example for `AsyncIterableFunctionReplacementProcessor` to properly handle multi-byte values in text decoder
- Fixed some benchmark search strategies to avoid emitting empty chunks when consecutive matches without gaps exist
- Clarified that `AsyncIterableFunctionReplacementProcessor` can replace with `AsyncIterable<string>` as well as `Promise<AsyncIterable<string>>`
- Consistent links to [`README.md`](../README.md) from this log

## [1.2.0] - 2026-04-06

### Added

- Added a `typecheck` npm script

### Changed

- Updated the async transformer implementation and typings to align with [the WHATWG Streams spec](https://streams.spec.whatwg.org/#transformer-api), including a compatibility type for `cancel()` while platform typings catch up
- Updated release workflow dependencies to latest versions
- Updated release-process documentation to match the current "Create Draft Release" workflow name
- Updated development dependencies to latest versions

### Fixed

- Clarified [`README.md`](../README.md) guidance for `promise`-valued replacements, back-pressure trade-offs, and cancellation with shared `AbortController`s
- Added WHATWG `Transformer.cancel()` support for async web transformers so stream cancellation stops further enqueues at the next async yield boundary
- Fixed minor documentation issues in the [`README.md`](../README.md) and search strategy docs
- Fixed the type for the `AsyncReplaceContentTransformer`, this only outputs `string` unlike the sync version which can also output `Promise<string>`
- Removed `"bun": ">=1.0.0", "deno": ">=1.40.0"` from `package.json` "engines" field, since not valid here
- Ensured that mid-chunk enacting of the `stopReplacingSignal` causes buffered content to appear in-order, rather than at the end of the stream

## [1.1.0] - 2026-03-22

### Added

- `streamIndices` property on `MatchResult` matches, providing absolute stream offsets `[startIndex, endIndex]` for each match

### Fixed

- Documentation:
  - Consistent prefix for examples in main [`README.md`](../README.md)
  - Fix typo in release process
  - Remove reference to un-exported `BufferedIndexOfAnchoredSearchStrategy`, linking to benchmarking code within repo instead
  - Note in regex JSDoc that lookahead support is positive only
  - Clarify in the benchmarking [`README.md`](../test/benchmarks/README.md) that `--experimental-strip-types` is a Node thing
  - Update a `NOTE` in the main [`README.md`](../README.md) to be a `CAUTION` and move under the example
- No longer exporting internal use only types.  Not publicly documented, so not considering this a breaking change
- Ensure the `BufferedIndexOfAnchoredSearchState`, `IndexOfKnuthMorrisPrattSearchStrategy` and `LoopedIndexOfCancellableSearchStrategy` benchmark comparison strategies properly resets their state

## [1.0.0] - 2026-01-23

### Changed

- **BREAKING:** `RegexSearchStrategy` replacement functions now receive `RegExpExecArray` instead of `string`. This enables direct access to capture groups (`match[1]`, `match.groups`), but existing code using string methods like `match.toUpperCase()` must change to `match[0].toUpperCase()`
- `MatchResult` type refactored to a discriminated union with boolean discriminant: `{ isMatch: false; content: string } | { isMatch: true; content: T }`. This is a breaking change for custom `SearchStrategy` implementations or direct `processChunk()` consumers. Use `if (result.isMatch)` to check for matches and access the typed content via `result.content`
- `SearchStrategy` interface now accepts a second type parameter for match type: `SearchStrategy<TState, TMatch = string>`
- Replacement processors now use `<TState, TMatch>` type parameters directly for improved type inference

### Added

- Exported `StringAnchorSearchState` type alias for typed processor declarations

### Fixed

- Added explicit `read` permission to the `ci.yml` GitHub actions workflow
- Various [`README.md`](../README.md) typos

## [0.2.0] - 2025-12-25

### Added

- Support for [`unicodeSets`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/unicodeSets) in the regex search strategy, via upgrade to [Version 0.2.0 of `regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/releases/tag/v0.2.0)
- Link to codeql runs on `main` from the [`README.md`](../README.md)

### Fixed

- Release pipeline updated to properly support semver selection in PR bodies, and updated ci pipeline to support valid casings, to match
- Updated stylesheet transclusion examples in [`README.md`](../README.md) for proper typing and realistic replacement

## [0.1.3] - 2025-12-22

### Added

- Added missing `package.json` metadata fields (`keywords`, `bugs`, `homepage`, `repository`) and configured pre-commit linting hooks

## [0.1.2] - 2025-12-22

### Fixed

- Removed `dry-run` flag from publish workflow to enable actual package publishing
- Added `test:ci` to the ci workflow, rather than `test`
- Removed needless guard in the `LoopedIndexOfAnchoredSearchStrategy`, logic is tautologous

## [0.1.1] - 2025-12-21

### Fixed

- Removed "CI" badge from [`README.md`](../README.md), this repository does not have post-merge CI on `main`
- Updated `pull_request_template.md` to reference issues, added "scout rule"
- Added `import` to conditional exports, following [conditional exports advice](https://nodejs.org/api/packages.html#conditional-exports)
- Fixed `CHANGELOG.md` update in release pipeline
- Used a GitHub app for `CHANGELOG.md` updates in release pipeline
- Ensured squash merges are recognised when determining semver etc.

### Added

- Issue templates
- "CodeQL" badge for [`README.md`](../README.md)

### Changed

- Updated to latest `regex-partial-match`

## [0.1.0] - 2025-12-20

### Added

- Core streaming content replacement functionality with boundary-aware pattern matching
- WHATWG Transformer adapters (`ReplaceContentTransformer`, `AsyncReplaceContentTransformer`)
- Node.js Transform stream adapters (`ReplaceContentTransform`, `AsyncReplaceContentTransform`)
- Multiple replacement processors:
  - `StaticReplacementProcessor` - Replace with static strings
  - `FunctionReplacementProcessor` - Replace with function-generated content
  - `IterableFunctionReplacementProcessor` - Replace with iterable/generator functions
  - `AsyncFunctionReplacementProcessor` - Replace with async functions
  - `AsyncIterableFunctionReplacementProcessor` - Replace with async iterables/generators
- Pluggable search strategies (anchor strings, regex)
- Search strategy factory for automatic strategy selection
- Full TypeScript support with type definitions
- Comprehensive test suite
- Performance benchmarks
- Support for Deno, Bun, Node.js, and browser environments
