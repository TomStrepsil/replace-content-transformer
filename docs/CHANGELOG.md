# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.0.0] - 2026-11-23

### Added

- Replacements can return UTF-8 bytes (`Uint8Array`), or an iterable or async iterable of them such as a `fetch` response body, with no `TextDecoderStream`, and `ReplaceContentTransformer` and `ReplaceContentTransform` emit bytes from an async replacement without decoding them. See [Async Iterable Replacement](./recipes.md#async-iterable-replacement)
- `Nested` and `nested()` take the source's chunk type as a type parameter, defaulting to `string`
- **BREAKING:** the replacement context has a `signal` that aborts when the engine is cancelled, as when the stream is cancelled or destroyed before it ends, or with `LookaheadTransformEngine` when `abandonPendingSignal` abandons the replacement, so a `fetch` passed it stops straight away. Code that builds a `ReplacementContext` itself, such as a custom engine, must now include one. See [Stream cancellation](./cancellation.md#stream-cancellation-the-context-signal) and [migrating](../codemods/transforms/v3-v4/README.md#the-replacement-contexts-signal)
- `EngineSink.deliveryDeferred`, optional, for a sink whose downstream can never observe output until the engine's current call returns. The web adapters set it
- `LeanRegexSearchStrategy`, which takes a `PartialMatchRegExp` built from `regex-partial-match/core` (or `withModules()`) so a bundle leaves out the full class, about 3.1 kB gzipped. `RegexSearchStrategy` is unchanged for callers. See [Lean Bundles](../src/search-strategies/regex/README.md#lean-bundles)
- Regex strategy tests over every two-way, three-way and per-character split of each curated pattern, asserting chunk invariance and lossless output
- Tests for engine cancellation, and for flushing rather than settling on abort
- `SearchStrategy` interface:
  - `settle(state, sink)`, optional, which decides what a strategy still holds once no further input can arrive, so a match deferred at the final chunk boundary can still be reported as a match. Engines call it at the end of the stream in place of `flush`, unless `stopReplacingSignal` has aborted. `RegexSearchStrategy` and `LeanRegexSearchStrategy` implement it. See [Search Strategies](./CONTRIBUTING.md#search-strategy-contract)
- `SearchStrategy`, `MatchSink` and `StreamIndices` are exported from the package root
- `RegexSearchStrategy`
  - Uses a `PartialMatchRegExp` it is given as it is, rather than rebuilding it with the default modules, so one built with `withModules(backreferencesWith({ longestPartial }))` keeps its limit. See [Backreferences](../src/search-strategies/regex/README.md#️-backreferences)
  - Options `maxBufferLength` (ceiling on held-back content, default `65536`), `onGuardExceeded` (called each time a candidate still unresolved `maxBufferLength` code units after its start passes through as text), `minCandidateLengthToBackOff` (default `1024`) and `bufferGrowthFactorBetweenEvaluations` (default `2`). See [Unbounded Quantifiers](../src/search-strategies/regex/README.md#️-unbounded-quantifiers)
- `StringAnchorSearchStrategy`, `BalancedPairSearchStrategy` and `searchStrategyFactory` take `maxBufferLength` and `onGuardExceeded` options. For a string needle, a `maxBufferLength` shorter than the anchors together throws a `RangeError`. Given a `RegExp`, `searchStrategyFactory` also takes `RegexSearchStrategy`'s backoff options, and its return type is the strategy built for the needle's type rather than a union. `BufferGuardOptions` is exported from the package root. See [Buffer limit](./search-strategies.md#buffer-limit)

### Changed

- **BREAKING:** `SerialTransformEngine` replaces `SyncReplacementTransformEngine` and `AsyncSerialReplacementTransformEngine`, completes a call synchronously unless a replacement in it is asynchronous, and calls a replacement before the text in front of its match is enqueued, unless it has a `stopReplacingSignal` and a sink that can react within the call. `TransformEngine` replaces `SyncTransformEngine` and `AsyncTransformEngine`, and `AsyncReplaceContentTransform` and `AsyncReplaceContentTransformer` are removed, since the other adapters take any engine. See [Engines](./engines.md#serialtransformengine) and [migrating](../codemods/transforms/v3-v4/README.md#codemod-rename-exports)
- **BREAKING:** Bun 1.4.0 is the minimum supported version, up from 1.0. See [Compatibility](./compatibility.md) and [migrating](../codemods/transforms/v3-v4/README.md#bun-140)
- **BREAKING:** `ReplaceContentTransformer` takes and emits UTF-8 `Uint8Array`, so a byte stream such as `Response.body` needs no `TextDecoderStream` or `TextEncoderStream`, and a string chunk errors the stream. A byte order mark at the start of the input is kept in the output but not searched. For a stream of strings, use `ReplaceContentTextTransformer`. See [WHATWG Transformer](./adapters.md#whatwg-streams) and [migrating](../codemods/transforms/v3-v4/README.md#bytes-or-text-on-the-web)
- **BREAKING:** `AsyncLookaheadTransformEngine` is renamed `LookaheadTransformEngine`, its options `LookaheadTransformEngineOptions`, and its `ReplacementFn` `LookaheadReplacementFn`. See [migrating](../codemods/transforms/v3-v4/README.md#codemod-rename-exports)
- **BREAKING:** `regex-partial-match` is a peer dependency rather than a dependency
  - npm 7+, pnpm 8+, Bun and Deno install it automatically; with Yarn, Classic or Berry, add it yourself. See [Installation](../README.md#-installation) and [migrating](../codemods/transforms/v3-v4/README.md#regex-partial-match-is-a-peer-dependency)
- **BREAKING:** every search strategy limits the content it holds back awaiting a decision to `maxBufferLength`, 65,536 code units by default. A match still incomplete that far from its start no longer matches: its text up to there passes through, and the search restarts after it, so a match after it can still match. Pass `maxBufferLength: Infinity` for the previous behaviour. See [Buffer limit](./search-strategies.md#buffer-limit) and [migrating](../codemods/transforms/v3-v4/README.md#maxbufferlength)
- `SearchStrategy` implementations:
  - **BREAKING:** reports text and matches to a `MatchSink` instead of returning a generator of `MatchResult`s, so a custom strategy must be rewritten. On match-dense input, `StringAnchorSearchStrategy` is about 2x faster with a synchronous replacement and 1.3x with an asynchronous one, and `RegexSearchStrategy` 1.3x and 1.1x. See [Search Strategies](./CONTRIBUTING.md#search-strategy-contract) and [migrating](../codemods/transforms/v3-v4/README.md#custom-search-strategies)
- `RegexSearchStrategy`
  - **BREAKING:** matches no longer depend on chunk boundaries, except where a chunk ends more than 64 characters into the text a backreference repeats, or inside a `v`-flag string of several code points, such as an emoji flag matched by `\p{RGI_Emoji}` (see [Strings of several code points](../src/search-strategies/regex/README.md#️-strings-of-several-code-points-v-flag)). A match that could still grow is deferred until the next chunk or the end of the stream, so tests asserting over chunked output may change. See [migrating](../codemods/transforms/v3-v4/README.md#regex-matches-no-longer-depend-on-chunk-boundaries)
  - Unbounded quantifiers (`/\S+/`) are now a buffering cost rather than a correctness caveat, and a long pending candidate is re-scanned only once the buffer has grown by a factor, so the cost is amortised linear in stream length rather than quadratic. See [Unbounded Quantifiers](../src/search-strategies/regex/README.md#️-unbounded-quantifiers)
- `StringAnchorSearchStrategy`
  - Checks whether a chunk ends part way through the first anchor only where that anchor's first character appears, so with small chunks and a long first anchor it is no longer slower than holding back a fixed tail. See [Why smart buffering](../src/search-strategies/looped-indexOf-anchored/README.md#why-smart-buffering)
- `SerialTransformEngine`
  - Enqueues all of a `write()` or `end()` call's synchronous output as one chunk, rather than one per text run, replacement and iterable piece. With a `stopReplacingSignal`, a sink that can react within the call, such as the Node adapter's, still receives output as it is produced. See [Engines](./engines.md#serialtransformengine)
- `LookaheadTransformEngine`
  - **BREAKING:** the constructor throws a `RangeError` unless `highWaterMark` is a whole number of at least 1, or `Infinity`, as for `maxBufferLength`. `NaN` was accepted and turned backpressure off, a fraction was accepted, and `null` selected the default. See [migrating](../codemods/transforms/v3-v4/README.md#lookaheadtransformengines-highwatermark)
  - `write()` awaits only while more than `highWaterMark` slots are queued, rather than once per queued slot. The text before a match is queued as one slot with it, so the queue holds at most two slots beyond `highWaterMark`, and adjacent text reaches the sink as one chunk. See [Backpressure](../src/engines/lookahead-transform-engine/README.md#backpressure-and-highwatermark)
- Once `stopReplacingSignal` aborts, engines stop searching instead of rendering every later match verbatim: straight after the output of the replacement that aborted it, or otherwise at the next match. What is left of the chunk and anything the search strategy holds are emitted as one chunk, unsettled, so the output text is unchanged but arrives in fewer, larger chunks
- Updated `regex-partial-match` to `^2.2.1` (for `hitEnd()`, `features()` and `isPartialMatchRegExp()`), which also fixes incomplete `\x`, `\u` and `\c` escapes and `\k<name>` on duplicated names, speeds up backreference patterns, about 20x on long input, no longer overflows V8's stack on a long run of an atom repeated by `*`, `+` or `{n,}`, and no longer drops a match where top-level alternatives with backreferences share a prefix, as `/(ab)\1|(abc)\2/` did. A backreference now matches part way only within the first 64 characters of its capture; see [Backreferences](../src/search-strategies/regex/README.md#️-backreferences) to raise that limit
- Updated the pinned `packageManager` npm version from 11.17.0 to 11.19.0
- The published `package.json` no longer includes `scripts`, `devDependencies`, `devEngines`, `workspaces` or git-hook config
- `README.md` is condensed to an overview, with the recipes and the detail of adapters, cancellation, search strategies, engines and compatibility moved to `docs/`, and the search strategy and engine contracts to `docs/CONTRIBUTING.md`

### Fixed

- **BREAKING:** `ReplaceContentTransform` no longer searches a byte order mark at the start of the input it decodes. It is kept at the start of the output, and `streamIndices` count from the text after it, as with a `TextDecoder`. See [Node Transform](./adapters.md#node-streams) and [migrating](../codemods/transforms/v3-v4/README.md#byte-order-mark-on-node)
- `LookaheadTransformEngine`
  - Fixed calling the replacement, after `stopReplacingSignal` aborts, for a match whose replacement had not yet been called, such as one waiting for a concurrency slot or in a `nested()` replacement's content. Such a match, and one scanned in the same tick as the abort, is now emitted verbatim, while replacements already called run to completion. See [Stopping new replacements](../src/engines/lookahead-transform-engine/README.md#stopping-new-replacements-stopreplacingsignal)
  - Fixed `end()` hanging after `cancel()` when a replacement never settles, never yields its first item, or stalls mid-stream, and after `abandonPendingSignal` when one never settles. A `nested()` source is no longer read after `cancel()`, and its child engine is cancelled with it
  - Fixed leaking concurrency slots after an error or `cancel()`, which could stall later replacements or hang `write()`
  - Fixed a child engine retaining its concurrency permit when reading a nested source fails
  - Fixed an unhandled rejection, which ends a Node process by default, when a replacement fails while an earlier one is still being read, or before the input ends. The stream errors with it as before
  - Fixed never closing the source of an abandoned `nested()` replacement, so a source such as a `fetch` body was left open when `cancel()` or `abandonPendingSignal` abandoned its slot. It is now closed once the drain loop reaches its slot, like a plain replacement
  - Fixed an unread `nested()` source that is a `ReadableStream` and never yields being left open when abandoned. It is now cancelled directly, rather than read first
  - Fixed carrying on after the search throws in `write()` or `end()`, such as from `onGuardExceeded`, which could leave an unhandled rejection. The engine now cancels itself, as when a replacement fails
  - Fixed a `nested()` replacement whose content fails with a falsy value, such as `undefined`, ending the stream as if it had succeeded
- Fixed `SerialTransformEngine` searching on to the next result, or reading on to a replacement's next piece, after `cancel()`, as `AsyncSerialReplacementTransformEngine` did. It now stops at once
- Fixed `SerialTransformEngine` leaving open an async iterable replacement it had called but not read when cancelled, as `AsyncSerialReplacementTransformEngine` did. A `ReadableStream` is now cancelled, and any other async iterable closed in the background once it next settles
- Fixed `cancel()` leaving open a `ReadableStream` replacement in either engine, or a `LookaheadTransformEngine` `nested()` source, whose read was pending, such as a stalled `fetch` body. It is now cancelled, which ends the read
- Fixed `write()` or `end()` never settling when the sink, such as a Node `data` listener, throws on a piece of a `ReadableStream` replacement whose `cancel` never settles, in either engine. The engine no longer waits for the stream to finish cancelling
- Fixed `SerialTransformEngine` cutting an async iterable replacement short when `stopReplacingSignal` aborts partway through it, as `AsyncSerialReplacementTransformEngine` did. A replacement already called now runs to completion, as with an iterable one and with `LookaheadTransformEngine`
- **BREAKING:** a replacement that fails, once `stopReplacingSignal` has aborted, with its `reason` or an `AbortError`, or an error with either in its `cause` chain, no longer errors the stream. It ends there, and its match is emitted verbatim if it had produced nothing. See [Limit replacements](./cancellation.md#stopping-requests-in-flight) and [migrating](../codemods/transforms/v3-v4/README.md#stopping-with-stopreplacingsignal)
- `ReplaceContentTransform`
  - **BREAKING:** an error the engine throws, such as from a synchronous replacement, destroys the stream with it rather than escaping `write()`. See [migrating](../codemods/transforms/v3-v4/README.md#errors-from-a-synchronous-replacement-on-node)
  - Fixed an engine rejecting with a reason that is not an `Error`, such as `undefined`, ending the stream as if it had succeeded, rather than destroying it with an `Error`
  - Fixed corrupting a multi-byte UTF-8 character split across `Buffer` chunks: each half was decoded on its own as U+FFFD. See [Node Transform](./adapters.md#node-streams)
  - Fixed corrupting an astral character, such as an emoji, when an output chunk ends between the two halves of its surrogate pair (e.g. a match for `/a./` in `"a😀"`): each half was encoded on its own as U+FFFD. A trailing high surrogate is now held back until the next chunk, as `TextEncoderStream` does
  - Fixed not calling `engine.cancel()` when the stream is destroyed before it ends, so `LookaheadTransformEngine` kept consuming scheduled replacements after a client disconnected or a `pipeline()` failed
  - **BREAKING:** output text is always encoded as UTF-8, rather than with the stream's `defaultEncoding`, such as `"latin1"` or `"utf16le"`. See [Node Transform](./adapters.md#node-streams) and [migrating](../codemods/transforms/v3-v4/README.md#node-output-is-always-utf-8)
- Fixed `ReplaceContentTransformer` and `ReplaceContentTextTransformer` rejecting `cancel()` with `Unable to enqueue` when the output is cancelled while the stream flushes. They now cancel the engine at its next output chunk, when `cancel()` resolves
- `RegexSearchStrategy`
  - Fixed chunk-dependent matches: premature starts, extents and alternatives, so `/[A-Z]+/` over `"MAT"` + `"CH"` yields `MATCH`, not `MAT` and `CH`. See [Scanning with the Partial Regex](../src/search-strategies/regex/README.md#scanning-with-the-partial-regex)
  - Fixed lookahead confirmation: captures are compared as well as extent, zero-length candidates are confirmed, and a capture inside a lookahead is no longer cut at the chunk edge. See [Lookahead Confirmation](../src/search-strategies/regex/README.md#lookahead-confirmation)
  - **BREAKING:** matches are a `StreamRegexMatch`, whose `index` and `indices` are stream-relative and whose `input` is `undefined`, rather than a `RegExpExecArray`. See [migrating](../codemods/transforms/v3-v4/README.md#regex-matches-are-a-streamregexmatch)
  - Fixed the end-of-stream settle stopping at a zero-length match instead of skipping it, which hid any real match later in the buffer
  - Fixed a skipped zero-length match (e.g. from `/a*/`) splitting an astral character such as an emoji into two output chunks. The skip now advances by one code point. See [Zero-length matches](../src/search-strategies/regex/README.md#️-zero-length-matches)
- Documented that engines should only be driven by an adapter. See [Engines](./engines.md#driving-an-engine)
- Documented that cancelling a WHATWG adapter's output after its input has ended waits for a replacement that has stalled, whose `signal` doesn't abort then, as with any `TransformStream` whose `flush()` is pending. See [Stream cancellation](./cancellation.md#stream-cancellation-the-context-signal)
- Corrected the first [Limit replacements](./cancellation.md#stop-replacing-stopreplacingsignal) example, which never stopped after two replacements, and returned nothing for a failed `fetch`
- Documented that Deno's `node:http` gives an aborted `http.get` the `stopReplacingSignal`'s reason as its `cause` from Deno 2.7.13. See [Limit replacements](./cancellation.md#stopping-requests-in-flight)
- Corrected the minimum browser versions to what the published code needs: Chrome and Edge 85, Firefox 102 and Safari 15, not Chrome 52, Edge 79, Firefox 65 and Safari 14.1. Documented that `LookaheadTransformEngine` also needs `AbortSignal.any()`, from Chrome and Edge 116, Firefox 124, Safari 17.4 and Deno 1.39. See [Compatibility](./compatibility.md)
- Documented that `TextEncoderStream` is slow on Node 22, Node 24 before 24.21.0 and Node 26 before 26.8.0, with a `TextEncoder` alternative that keeps surrogate pairs split across output chunks intact. See [WHATWG Transformer](./adapters.md#encoding-the-output-on-older-node)
- Fixed `BalancedPairSearchStrategy` dropping text after a nested match when a chunk ends inside the outer pair, e.g. `"(((a)b)"` followed by `" tail"` lost `" tail"`
- Fixed benchmarking `AnchorSequenceSearchStrategy`: a sequence completing on the last chunk is yielded as a match at the end of the stream, state resets between streams, and a non-string `TMatch` is no longer rendered as `"[object Object]"`
- Documented that input must be decoded with a `TextDecoder`/`TextDecoderStream` so surrogate pairs are never split. See [Surrogate pairs split across chunks](../src/search-strategies/regex/README.md#️-surrogate-pairs-split-across-chunks)
- Removed regex strategy tests that should have gone with [3.0.0](#300---2026-07-28)
- Fixed engine tests that waited a fixed number of microtasks: a "not yet" check that couldn't fail, a `cancel()` test that missed the check it is named for, and 11 waits that did nothing. Tests that need to wait now use `setImmediate()`
- Fixed `LoopedIndexOfAnchoredSearchStrategy` and `BalancedPairSearchStrategy` re-scanning anchors already consumed when a chunk boundary falls mid-match, which could match the wrong text
- Fixed benchmarking `looped-indexOf-cancellable` and `regex-callback` enqueuing empty chunks
- Fixed benchmarking `BalancedPairRegexCountSearchStrategy` differing from `BalancedPairSearchStrategy` in more than how it counts openings: it buffered the open pair its own way and had no buffer guard. It now extends `BalancedPairSearchStrategy` and overrides only the count
- Fixed some nits in `docs/CONTRIBUTING.md`

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

- Path in lookahead transformer [`README.md`](../src/engines/lookahead-transform-engine/README.md) back to [main `README.md`](../README.md)
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
- No longer exporting internal use only types. Not publicly documented, so not considering this a breaking change
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
