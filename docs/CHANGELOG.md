# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.2] - 2026-08-27

### Fixed

- Fixed double-offset named capture group indices in the regex search strategy when using the `d` flag across chunk boundaries
- Fixed the string anchor search strategy reporting characters twice at a chunk boundary, and the phantom overlapping match that could follow, when an anchor has a border (a proper prefix that is also a suffix, e.g. `---`, `aba`)
  - Also covers `BalancedPairSearchStrategy`, which delegates to it

## [3.0.1] - 2026-08-25

### Fixed

- Fixed an infinite loop when a regex pattern could produce a zero-length match (e.g. `/a?/`, `/a*/`, `/(?=a)/`). Zero-length matches are now skipped rather than emitted, so a nullable pattern matches only where it matches something — `/\d*/` behaves as `/\d+/`. See [limitations](../src/search-strategies/regex/README.md#limitations).
  - Fixed the same loop in the string anchor search strategy: empty anchors (`searchStrategyFactory("")`, `["", ""]`) are now rejected at construction
     - Also covers `BalancedPairSearchStrategy`, which delegates to it
- Ensured Dependabot can raise PRs without being blocked by CI

### Changed

- Updated `regex-partial-match` to 1.1.2

## [3.0.0] - 2026-07-28

### Changed

- Updated to `regex-partial-match` v1.1.0, switching the regex search strategy's input validation from a source-string heuristic (`.source.includes(...)`) to the new `features` export, populated from `regex-partial-match`'s own parse of the pattern's syntax. This also fixes false-positive validation errors for patterns where lookahead/lookbehind/boundary-like character sequences appear literally rather than as the construct itself (e.g. a character class like `[(?!]`, or an escaped `\^foo\$`)

### Removed

- **BREAKING:** Removed support for `^`/`$` anchors, `\b`/`\B` word boundaries, and the `m` (multiline) flag in the regex search strategy. These previously appeared in the README as "✅ Supported" but could silently produce false-positive matches — e.g. a boundary landing at a chunk edge, or immediately after an earlier match within the same chunk — since native `^`/`$`/`\b`/`\B` evaluate against whatever substring `exec()` happens to be called with, not the true start/end of the stream. Now rejected by [input validation](../src/search-strategies/regex/input-validation.ts) at construction time instead of returning incorrect results; see [limitations](../src/search-strategies/regex/README.md#limitations)

### Fixed

- Fixed regex strategy README to show the actual end-of-input disjunction now employed by `regex-partial-match@1.x`
  - clarify note about negative lookaheads being unsupported does not prevent this from working

## [2.2.0] - 2026-07-22

### Added

- Added support for backreferences (`\1`, `\k<name>`) when using the regex search strategy. See [limitations](../src/search-strategies/regex/README.md#limitations) for streaming-specific caveats (performance, and a known prefix-ambiguous top-level alternation limitation that can drop a match spanning chunks)

### Changed

- Updated to `regex-partial-match` v1.0.0 to support backreferences
  - N.B. This introduces a ~2.6x construction cost for the regex search strategy, due to the new "parts" array constructed to support an `exec()` override and `super()` performing (at least) two `RegExp` constructions. This happens even if backreferences are not part of the pattern. Considered an acceptable trade-off for the added flexibility, and should be amortised by re-use of the strategy once constructed in the common use-case.

### Fixed

- Updated [main `README.md`](../README.md) to list the proper number of comparison search strategies
- Fixed npm version in `packageManager` to be valid
- Replaced the inline `CorrectedRegExpIndicesArray` workaround in the regex search strategy with a local [`@typescript/lib-es2022`](../types/README.md) `libReplacement` lib override, fixing `RegExpIndicesArray` typing for `undefined` named-group indices in this repo’s TypeScript build (see [microsoft/TypeScript#63281](https://github.com/microsoft/TypeScript/issues/63281))
- Added a [`setup-node`](../.github/actions/setup-node/action.yml) action to the CI/publish/release pipelines, running `corepack enable`/`corepack install` after `actions/setup-node` (mitigating [actions/setup-node#1553](https://github.com/actions/setup-node/issues/1553)) so the pinned, hash-verified npm version in `packageManager` is actually the one that runs `npm ci`, `npm run lint`, `npm test`, `npm publish`, and `npm version`

### Removed

- Removed input validation that previously rejected backreferences
- Explicitly removed support for sticky/global regexes in the regex search strategy, now rejected by input validation
  - Despite being a breaking change, this never really worked before, so considering a "patch"

## [2.1.0] - 2026-05-24

### Added

- `BalancedPairSearchStrategy` search strategy for matching two string anchors, but respecting nesting levels so only matching where "balanced"
- `BalancedPairRegexCountSearchStrategy` benchmarking-only search strategy, as above but counting opening delimiter occurrences on each newly appended match segment via `newContent.match(openingRegex)` for nesting-level adjustment, for comparison to looped `indexOf`

### Changed

- Removed note regarding lack of `cancel?` in the `TransformStream/transformer` type after resolution of https://github.com/nodejs/node/issues/62540
- Ensured utf-8 note referenced in public Node adapter jsdocs
- Ensured `TextDecoderStream` recommendation in jsdoc notes for web adapters
- Node examples in [main `README.md`](../README.md) consolidated to single example, and added belt & braces integration test using `nested`

### Fixed

- Path in lookahead transformer [`README.md`](../src/engines/async-lookahead-transform-engine/README.md) back to [main `README.md`](../README.md)
- Added `[!CAUTION]` to `README.md` re: `UTF-8`

## [2.0.0] - 2026-05-11

### Changed

- **BREAKING:** Replacement callbacks now receive `match` as the first parameter and `context` as the second: `(match, context: ReplacementContext) => ...`
- **BREAKING:** Made Node minimum version 22 (LTS)
  - support for `import.meta.dirname` required Node 20+, and the project baseline was aligned to Node 22 LTS, to allow use of [`Promise.withResolvers`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers)
- **BREAKING:** `ReplaceContentTransformer` and `AsyncReplaceContentTransformer` (web) and `ReplaceContentTransform` and `AsyncReplaceContentTransform` (Node) now accept an engine as their sole constructor argument, replacing the former `(processor, stopReplacingSignal?)` signature; see "added" below
  - `stopReplacingSignal` has moved into engine options (`SyncReplacementTransformEngineOptions`, `AsyncSerialReplacementTransformEngineOptions`, `AsyncLookaheadTransformEngineOptions`).
- **BREAKING:** `SyncReplacementTransformEngineOptions` (nee `FunctionReplacementProcessor`) no longer accepts a `Promise<string>` replacement type; its replacement function must now return `string`. The previous pattern of enqueuing promises onto the stream for downstream `await` has been superseded by `AsyncLookaheadTransformEngine`, which provides pipelined async replacement with in-order output and bounded concurrency. Consequently:
  - `ReplaceContentTransformer` drops its `T extends string | Promise<string>` type parameter; it is now typed `void`
  - Migration: see [codemods](../codemods/transforms/v1-v2/README.md)
- Updated `regex-partial-match` to [v0.3.0](https://github.com/TomStrepsil/regex-partial-match/releases/tag/v0.3.0)
- Updated eslint config to use [`projectService`](https://typescript-eslint.io/blog/project-service/) for improved typescript integration
- Switched internal imports to explicit `.js` specifiers for better ESM/type export compatibility
  - For direct TypeScript execution paths (notably benchmark/harness code run via `deno run`), switched selected internal imports from `.js` to `.ts` so strict Deno module resolution works without `--sloppy-imports`
- Updated `vitest` to [version 4.1.5](https://github.com/vitest-dev/vitest/releases/tag/v4.1.5)
- Removed [`msw`](https://github.com/mswjs/msw/) dependency
- Moved `prepublishOnly` script to `prepack`, since canonically that's the place to build

### Added

- A `"codemods"` workspace, plus a `jscodeshift` codemod, `npx jscodeshift` download-then-run instructions (plus in-repo scripts, for completeness), to migrate replacement callbacks from positional arguments to `(match, context)` form, plus one for processor-to-engine refactor
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
- Protocol-agnostic engine layer replacing the former processor classes, all exported from `replace-content-transformer`:
  - `SyncReplacementTransformEngine` — absorbs `StaticReplacementProcessor`, `FunctionReplacementProcessor`, and `IterableFunctionReplacementProcessor`; replacement function returns `string | Iterable<string>`
  - `AsyncSerialReplacementTransformEngine` — absorbs `AsyncFunctionReplacementProcessor` and `AsyncIterableFunctionReplacementProcessor`; each replacement is fully consumed before scanning continues
  - `AsyncLookaheadTransformEngine` — scans for matches and **eagerly initiates** replacement work as they are discovered, rather than serially awaiting each; downstream output order is preserved while concurrent initiation of async iterable replacements unlocks pipelined I/O (e.g. parallel fragment fetches with in-order rendering)
  - `TransformEngineBase` — abstract base class shared by all three engines
- New types exported from `replace-content-transformer`:
  - `EngineSink` — `{ enqueue(chunk: string): void; error(err: unknown): void }` interface supplied by adapters to engines
  - `ReplacementContext` — `{ matchIndex, streamIndices }` passed to all replacement callbacks
  - `LookaheadReplacementContext` — extends `ReplacementContext` with `depth` for `AsyncLookaheadTransformEngine` replacement callbacks
  - `SyncTransformEngine`, `AsyncTransformEngine` — engine interfaces for custom implementations
- `nested(source)` sentinel for opt-in recursive re-scanning: returning `nested(body)` from an `AsyncLookaheadTransformEngine` replacement function signals that the engine should spawn a child (sharing the same search strategy, concurrency strategy, and replacement function) to re-process the body; a plain `AsyncIterable<string>` return emits the body verbatim. Nested work competes for the same concurrency budget and is ordered across nesting levels by tree-aware comparators
- `highWaterMark` option on `AsyncLookaheadTransformEngine` (default `32`) — caps the number of slots the scanner may buffer ahead of the drainer, providing upstream backpressure when downstream stalls
- Pluggable `ConcurrencyStrategy` interface with two built-in implementations:
  - `SemaphoreStrategy` — FIFO arrival-order dispatch bounded by a concurrency limit
  - `PriorityQueueStrategy` — heap-backed, slot-tree-aware, pairs with a `NodeComparator` to order queued work across nesting levels
- Two built-in comparators for `PriorityQueueStrategy`: `streamOrder` (earlier-in-output-stream first, via LCA) and `breadthFirst` (shallower first, siblingIndex tie-break)
- Supporting types for custom `ConcurrencyStrategy` implementations: `SlotTreeNode`, `IterableSlotNode`, `TextSlotNode`, `SlotNode`, `NodeComparator`
- Pre-release workflow

### Removed

- Replacement processors and `SyncProcessor` / `AsyncProcessor` types, supporting move to "engines" mentioned above

### Fixed

- Corrected some paths in docs for the runtime benchmarks
- Fixed some benchmark search strategies to avoid emitting empty chunks when consecutive matches without gaps exist
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
