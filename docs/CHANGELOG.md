# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING:** Replacement callbacks now receive `match` as the first parameter and `context` as the second: `(match, context: ReplacementContext) => ...`
- **BREAKING:** Made Node minimum version 22 (LTS) - support for `import.meta.dirname` (Node 20) required
- Updated `regex-partial-match` to [v0.3.0](https://github.com/TomStrepsil/regex-partial-match/releases/tag/v0.3.0)
- Updated eslint config to use [`projectService`](https://typescript-eslint.io/blog/project-service/) for improved typescript integration
- Moved to extension-less imports for better type exports


### Added

- `bench:compare-runtimes` package script, enacting the `runtime/compare.ts` script previously undocumented
- Updated benchmark search strategies to include proper stream indices, to support parity of functionality

### Fixed

- Corrected some paths in docs for the runtime benchmarks
- Corrected JSDoc example for `AsyncIterableFunctionReplacementProcessor` to properly handle multi-byte values in text decoder
- Fixed some benchmark search strategies to avoid emitting empty chunks when consecutive matches without gaps exist

## [1.2.0] - 2026-04-06

### Added

- Added a `typecheck` npm script

### Changed

- Updated the async transformer implementation and typings to align with [the WHATWG Streams spec](https://streams.spec.whatwg.org/#transformer-api), including a compatibility type for `cancel()` while platform typings catch up
- Updated release workflow dependencies to latest versions
- Updated release-process documentation to match the current "Create Draft Release" workflow name
- Updated development dependencies to latest versions

### Fixed

- Clarified README guidance for `promise`-valued replacements, back-pressure trade-offs, and cancellation with shared `AbortController`s
- Added WHATWG `Transformer.cancel()` support for async web transformers so stream cancellation stops further enqueues at the next async yield boundary
- Fixed minor documentation issues in the README and search strategy docs
- Fixed the type for the `AsyncReplaceContentTransformer`, this only outputs `string` unlike the sync version which can also output `Promise<string>`
- Removed `"bun": ">=1.0.0", "deno": ">=1.40.0"` from `package.json` "engines" field, since not valid here
- Ensured that mid-chunk enacting of the `stopReplacingSignal` causes buffered content to appear in-order, rather than at the end of the stream

## [1.1.0] - 2026-03-22

### Added

- `streamIndices` property on `MatchResult` matches, providing absolute stream offsets `[startIndex, endIndex]` for each match

### Fixed

- Documentation:
  - Consistent prefix for examples in main README
  - Fix typo in release process
  - Remove reference to un-exported `BufferedIndexOfAnchoredSearchStrategy`, linking to benchmarking code within repo instead
  - Note in regex JSDoc that lookahead support is positive only
  - Clarify in the benchmarking README that `--experimental-strip-types` is a Node thing
  - Update a `NOTE` in the main README to be a `CAUTION` and move under the example
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
- Various `README.md` typos

## [0.2.0] - 2025-12-25

### Added

- Support for [`unicodeSets`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/unicodeSets) in the regex search strategy, via upgrade to [Version 0.2.0 of `regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/releases/tag/v0.2.0)
- Link to codeql runs on `main` from the `README.md`

### Fixed

- Release pipeline updated to properly support semver selection in PR bodies, and updated ci pipeline to support valid casings, to match
- Updated stylesheet transclusion examples in `README.md` for proper typing and realistic replacement

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
