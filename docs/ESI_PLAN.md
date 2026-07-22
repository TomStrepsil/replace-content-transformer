# ESI Transformer — Implementation Plan

## Overview

Two-phase implementation:

1. **Phase 1 — `replace-content-transformer` (this repo):** A single PR that refactors
   `AsyncLookaheadTransformEngine` to extract shared lookahead infrastructure into a
   composable `LookaheadCore` object, then adds `OptimisticPairTransformEngine` as a second
   engine that composes the same core. The refactor and new engine ship together so the
   composition is validated before the API is published.

2. **Phase 2 — `esi-transformer` (new separate repo):** A streaming ESI processor built on
   the primitives from Phase 1. Linked to this repo via `file:` during development, published
   independently once stable.

---

## Phase 1 — `replace-content-transformer`

### PR: `LookaheadCore` + `OptimisticPairTransformEngine`

#### Motivation

`AsyncLookaheadTransformEngine` contains two separable concerns:

- **Lookahead infrastructure** — slot queue, ordered drain loop, `nested()` child spawning,
  abort/cancel signal composition, backpressure. This is reusable.
- **Match-based scanning** — single search strategy, `TMatch`-typed replacement function,
  pluggable concurrency strategy. This is specific to the current engine.

`OptimisticPairTransformEngine` shares the infrastructure but has a fundamentally different
scan model: two single-anchor strategies (open + close) with the replacement receiving a
bounded `ReadableStream<string>` rather than a buffered match.

Because the replacement signature changes, a new concrete class is warranted rather than an
option on the existing engine. The shared infrastructure is extracted into a composable
`LookaheadCore` object that both engines hold as a private field and delegate to, rather
than an abstract base class they extend. This keeps the class hierarchy flat and makes the
core independently testable.

#### Engine structure (composition, not inheritance)

```
TransformEngineBase                          (search strategy state — unchanged)
  ├─ SyncReplacementTransformEngine          (unchanged)
  └─ AsyncSerialReplacementTransformEngine   (unchanged)

LookaheadCore                                (NEW — standalone composable object)

AsyncLookaheadTransformEngine                (refactored: holds #core: LookaheadCore)
OptimisticPairTransformEngine                (NEW: holds #core: LookaheadCore)
```

`AsyncLookaheadTransformEngine` no longer extends `TransformEngineBase` — it composes
`LookaheadCore` directly and handles its own search strategy state internally. This is a
non-breaking internal change; the public API and `AsyncTransformEngine` interface are
unchanged.

---

### Step 1 — Extract `LookaheadCore`

**File:** `src/engines/lookahead-core.ts`

`LookaheadCore` is a plain (non-abstract) class that owns the lookahead infrastructure
extracted from `AsyncLookaheadTransformEngine`. It is not an engine itself — it has no
`write()` method and implements no engine interface. Both concrete engines hold it as a
private field.

#### Interface

```ts
type ChildCoreFactory = (
  parent: IterableSlotNode,
  depth: number
) => LookaheadCore;

interface LookaheadCoreOptions {
  highWaterMark?: number;
  stopReplacingSignal?: AbortSignal;
  abandonPendingSignal?: AbortSignal;
}

class LookaheadCore {
  constructor(
    options: LookaheadCoreOptions,
    /**
     * Factory used by #runNested() to create a child core of the correct
     * concrete engine type. Passed as a closure at construction time so the
     * core never needs to know which outer engine it belongs to.
     *
     * Typically: (parent, depth) => new ConcreteEngine({ ...outerOptions,
     *   abandonPendingSignal: this.abandonSignal }, parent, depth).core
     */
    childFactory: ChildCoreFactory,
    parent?: IterableSlotNode | null,
    depth?: number
  )

  /** Composed abort signal — passed to slot factories that need it. */
  get abandonSignal(): AbortSignal;
  get depth(): number;
  get siblingIndex(): number;        // read by outer engine; incremented via nextSiblingIndex()
  nextSiblingIndex(): number;        // returns current value then increments

  /** Attach sink and start drain loop. Call once before any pushSlot(). */
  start(sink: EngineSink): void;

  /** Push a slot onto the queue. Suspends when queue is at highWaterMark. */
  pushSlot(slot: SlotNode): Promise<void>;

  /** Abort all in-flight work and close the queue. */
  cancel(): void;

  /** Close the queue and await the drain loop. */
  end(): Promise<void>;
}
```

#### What moves from `AsyncLookaheadTransformEngine` into `LookaheadCore`

| Member | Notes |
|---|---|
| `#queue: AsyncChildQueue` | Slot queue with high-water-mark backpressure |
| `#drainDone: Promise<void>` | Resolves when drain loop exits |
| `#cancelled: boolean` | Set by `cancel()` |
| `#cancelAbortController: AbortController` | Internal abort for cancel |
| `#abandonSignal: AbortSignal` | Composed from options + cancel |
| `#depth: number` | Nesting depth (0 = root) |
| `#parent: IterableSlotNode \| null` | Used by `#runNested` |
| `#siblingIndex: number` | Monotonic slot index |
| `start(sink)` | Attaches `EngineSink`, kicks off `#drain()` |
| `cancel()` | Aborts signals, closes queue |
| `end()` | Closes queue, awaits drain |
| `#drain()` | Iterates queue, calls `#emitSlot` |
| `#emitSlot(slot)` | Handles text slots and iterable slots |
| `#runNested(source, parent)` | Creates child via `childFactory`, bridges sink |

#### How `AsyncLookaheadTransformEngine` uses `LookaheadCore`

```ts
class AsyncLookaheadTransformEngine {
  readonly #core: LookaheadCore;
  readonly #options: AsyncLookaheadTransformEngineOptions;

  constructor(options, parent = null, depth = 0) {
    this.#options = options;
    this.#core = new LookaheadCore(
      options,
      (p, d) => new AsyncLookaheadTransformEngine(
        { ...this.#options, abandonPendingSignal: this.#core.abandonSignal },
        p, d
      ).#core,
      parent, depth
    );
  }

  start(sink)         { this.#core.start(sink); }
  cancel()            { this.#core.cancel(); }
  async end()         { return this.#core.end(); }

  async write(chunk)  {
    // scanning logic unchanged — pushes text slots and iterable slots via:
    await this.#core.pushSlot(slot);
  }
}
```

`OptimisticPairTransformEngine` follows the identical shape: holds `#core`, delegates
lifecycle, contributes only its open/close scanning logic in `write()`.

**Validation:** All existing tests must pass without modification. No new tests are needed
for `LookaheadCore` itself at this step — the refactor is purely structural. The core
becomes independently testable in isolation if desired.

---

### Step 2 — Add `OptimisticPairTransformEngine`

**File:** `src/engines/optimistic-pair-transform-engine/engine.ts`  
**Index:** `src/engines/optimistic-pair-transform-engine/index.ts`  
**Export:** Add to `src/engines/index.ts`

#### Options interface

```ts
export interface OptimisticPairTransformEngineOptions {
  /**
   * Single-anchor search strategy that identifies the opening delimiter.
   * e.g. searchStrategyFactory(["<!--esi"])
   */
  openStrategy: SearchStrategy<unknown, unknown>;

  /**
   * Single-anchor search strategy that identifies the closing delimiter.
   * e.g. searchStrategyFactory(["-->"])
   */
  closeStrategy: SearchStrategy<unknown, unknown>;

  /**
   * Called as soon as the open anchor is found. Receives a ReadableStream<string>
   * that is fed with chunks from the source until the close anchor is found,
   * at which point the stream is closed. Both anchors are consumed (not forwarded).
   *
   * Return an AsyncIterable<string> to emit replacement content in-order, or
   * Nested to re-apply this engine's own pipeline to a sub-stream.
   */
  replacement: (
    innerStream: ReadableStream<string>,
    ctx: ReplacementContext
  ) => Promise<AsyncIterable<string> | Nested>;

  /**
   * Controls how many inner pipelines may be in-flight concurrently.
   * Drain order is always FIFO — PriorityQueueStrategy has no applicable
   * semantics here, so the type is narrowed to SemaphoreStrategy.
   * Use SemaphoreStrategy(Infinity) for unbounded concurrency.
   */
  concurrencyStrategy: SemaphoreStrategy;

  /** @see AsyncLookaheadTransformEngineOptions.highWaterMark */
  highWaterMark?: number;

  /** @see AsyncLookaheadTransformEngineOptions.stopReplacingSignal */
  stopReplacingSignal?: AbortSignal;

  /** @see AsyncLookaheadTransformEngineOptions.abandonPendingSignal */
  abandonPendingSignal?: AbortSignal;
}
```

#### Scan behaviour

The scanner maintains two states: **OPEN** (looking for the open anchor) and **CLOSE**
(looking for the close anchor, routing chunks to the current inner stream).

```
OPEN mode:
  Non-match content  → push as text slot to queue (emitted immediately by drain)
  Open anchor found  → acquire semaphore slot
                     → create ReadableStream + controller (innerStream / innerController)
                     → push iterable slot to queue (calls replacement(innerStream))
                     → switch to CLOSE mode

CLOSE mode:
  Non-match content  → push chunk to innerController
  Close anchor found → close innerController (signals end of innerStream to replacement fn)
                     → switch to OPEN mode
```

At most one `innerController` is live at any time in the scanner. Multiple inner pipelines
may be in-flight concurrently (their replacement functions are running), but the scanner
itself advances sequentially: open → close → open → close.

If the semaphore is at capacity when an open anchor is found, `write()` suspends (backpressure)
until a slot is released.

On `end()`: if the scanner is still in CLOSE mode (unclosed open anchor at end of stream),
close `innerController` before closing the queue. The replacement function will receive a
truncated stream; behaviour is determined by the replacement implementation.

#### Concurrency and FIFO drain

Drain order is FIFO by construction: the open anchor for slot N always appears before slot
N+1 in the source stream. The `AsyncChildQueue` (inside `LookaheadCore`) enforces in-order
emission. Unlike `AsyncLookaheadTransformEngine`, `PriorityQueueStrategy` is not accepted —
the concurrency strategy parameter type is `SemaphoreStrategy` only.

#### Child factory closure

`OptimisticPairTransformEngine` passes its child factory to `LookaheadCore` at construction,
mirroring the pattern used by `AsyncLookaheadTransformEngine`:

```ts
this.#core = new LookaheadCore(
  options,
  (p, d) => new OptimisticPairTransformEngine(
    { ...this.#options, abandonPendingSignal: this.#core.abandonSignal },
    p, d
  ).#core,
  parent, depth
);
```

#### Tests

**File:** `src/engines/optimistic-pair-transform-engine/engine.test.ts`

Cover the following cases (TDD — write tests first):

| Case | Description |
|---|---|
| Basic strip | Single `<!--esi content -->` — both anchors stripped, content emitted |
| Async replacement | Replacement returns a promise; content emitted in order |
| Multiple pairs | Two `<!--esi...-->` blocks in one stream — both processed, interleaving content preserved |
| Concurrent in-flight | Two blocks where second open is found before first replacement resolves; outputs emitted in source order |
| Cross-chunk open anchor | Open anchor split across two `write()` calls |
| Cross-chunk close anchor | Close anchor split across two `write()` calls |
| Semaphore limit | `SemaphoreStrategy(1)` — second block waits until first completes |
| Unclosed at end | Stream ends while in CLOSE mode — `end()` resolves, truncated innerStream closed |
| `nested()` return | Replacement returns `nested(innerStream)` — child engine re-processes content |
| `cancel()` mid-flight | `cancel()` called while replacement is running — resolves without deadlock |
| `stopReplacingSignal` | Aborted before second open anchor — second block passed through verbatim |
| `abandonPendingSignal` | In-flight replacement abandoned — original content emitted in its place |

**File:** `src/engines/optimistic-pair-transform-engine/engine.integration.test.ts`

End-to-end through the web adapter (`AsyncReplaceContentTransformer`) and node adapter,
mirroring the integration test pattern used for `AsyncLookaheadTransformEngine`.

---

### Exports checklist

- [ ] `LookaheadCore` — exported from `src/engines/index.ts` (public, needed by downstream
  packages implementing custom lookahead-style engines)
- [ ] `LookaheadCoreOptions` — exported type
- [ ] `ChildCoreFactory` — exported type
- [ ] `OptimisticPairTransformEngine` — exported from `src/engines/index.ts`
- [ ] `OptimisticPairTransformEngineOptions` — exported type
- Existing exports unchanged

---

## Phase 2 — `esi-transformer` (new repo)

### Repo setup

- New git repository: `esi-transformer`
- During development, add to `replace-content-transformer` workspace:
  ```json
  "workspaces": ["test/benchmarks", "codemods", "../esi-transformer"]
  ```
  and link in `package.json` dependencies:
  ```json
  "replace-content-transformer": "file:../replace-content-transformer"
  ```
- Mirror tooling from `replace-content-transformer`: TypeScript, Vitest, ESLint,
  `simple-git-hooks`, dual ESM/CJS build via `build.js`
- Runtime targets: Node ≥ 22, Bun, Deno, Cloudflare Workers (WHATWG Streams throughout —
  no Node stream APIs in core)

---

### Public API

```ts
// replace-content-transformer/esi-transformer/src/types.ts

export type FetchFn = (url: URL, ctx: EsiRequestContext) => Promise<Response>;

export interface EsiRequestContext {
  /** The URL of the original request — used for relative src= resolution and variable defaults. */
  url: URL;
  /** Headers of the original request — used for HTTP_* variable resolution. */
  headers: Headers;
}

export interface EsiIncludeContext {
  /**
   * Which URL's path is exposed as REQUEST_PATH inside an included fragment.
   * 'fragment' (default, spec-compliant): the fragment's own URL path.
   * 'origin': the original request's path (non-standard).
   */
  requestPath: 'origin' | 'fragment';

  /**
   * Which query string is exposed as QUERY_STRING inside an included fragment.
   * 'merged' (default, Akamai-compatible): fragment params merged over origin params.
   * 'fragment': fragment's own query string only.
   * 'origin': original request's query string only.
   */
  queryString: 'origin' | 'fragment' | 'merged';
}

export interface EsiOptions {
  /** Maximum recursive include depth. Default: 5. */
  maxDepth?: number;
  /**
   * Error handling for failed includes (non-2xx response or network error).
   * 'continue': emit empty string (mirrors onerror="continue" attribute).
   * 'throw': propagate the error, aborting the stream.
   * Default: respects the onerror= attribute on each <esi:include>; falls back to 'throw'.
   */
  onIncludeError?: 'continue' | 'throw';
  /** Variable resolution behaviour inside included fragments. */
  includeContext?: EsiIncludeContext;
}

/**
 * Returns a function that applies ESI processing to a ReadableStream<string>.
 * Call once per request — the returned function is stateless across calls but
 * closes over the fetch function, request context, and options.
 *
 * The input stream must already be text-decoded (TextDecoderStream is the caller's
 * responsibility). The output stream is also ReadableStream<string>.
 */
export declare function createEsiTransform(
  fetch: FetchFn,
  context: EsiRequestContext,
  options?: EsiOptions
): (stream: ReadableStream<string>) => ReadableStream<string>;
```

Usage across runtimes:

```ts
// Cloudflare Workers / Bun / Deno / Node 18+
const process = createEsiTransform(fetch, { url, headers }, { maxDepth: 5 });
return new Response(process(body.pipeThrough(new TextDecoderStream())));
```

---

### ESI spec compliance notes

**Relative `src=` URLs:** The ESI 1.0 W3C spec resolves relative URIs in `src=` against
the base URI of the *including* document (same as HTML). A fragment at `/partials/nav.html`
resolves `src="logo.html"` as `/partials/logo.html`. This is the default. The `includeContext`
option deviates only for variable resolution, not URL resolution.

**`-->` inside ESI comment content:** `<!--esi...-->` is an HTML comment; `-->` terminates
it at the first occurrence. If ESI content contains a literal `-->` sequence (e.g. inside
a `test=""` attribute value), the comment closes prematurely. This affects all ESI processors
equally — documented as a known limitation.

---

### Feature tiers

#### Tier 1 — Varnish preset (`presets/varnish.ts`)

- `<!--esi...-->` passthrough reveal (via `OptimisticPairTransformEngine`)
- `<esi:include src="..." onerror="continue|throw"/>` with recursive depth guard

Exported as:
```ts
import { createEsiTransform } from 'esi-transformer/varnish';
```

#### Tier 2 — ESI 1.0 preset (`presets/esi10.ts`)

Everything in Tier 1 plus:
- `<esi:remove>...</esi:remove>`
- `<esi:comment text="..."/>`
- `<esi:vars>...</esi:vars>` with variable substitution
- `<esi:choose>/<esi:when test="">/<esi:otherwise>`

ESI 1.0 variables: `REQUEST_PATH`, `QUERY_STRING{key}`, `HTTP_COOKIE{name}`, `HTTP_HOST`,
`HTTP_REFERER`, `HTTP_USER_AGENT`, `HTTP_ACCEPT_LANGUAGE`.

Exported as:
```ts
import { createEsiTransform } from 'esi-transformer'; // default
import { createEsiTransform } from 'esi-transformer/esi10'; // explicit
```

#### Tier 3 — Akamai preset (future)

Extended variable set, `<esi:assign>`, `<esi:eval>`, `<esi:foreach>`, `<esi:function>`,
`<esi:inline>`. Some tags require mutable per-request state threaded through the pipeline —
design deferred.

#### `esi:try/attempt/except` — deferred

Requires either buffered-slot semantics (breaks TTFB for affected slot) or best-effort
streaming (partial content already sent on error). Will be added with an explicit caveat
and opt-in behaviour.

---

### Internal pipeline architecture

Passes are composed as a `pipeThrough` chain. Each pass sees the output of the previous.

#### Pass 1 — Sync tag stripping (`SyncReplacementTransformEngine`)

Applied first so these tags are removed before the reveal pass exposes new content.

| Tag | Strategy | Replacement |
|---|---|---|
| `<esi:remove>...</esi:remove>` | `searchStrategyFactory(["<esi:remove", "</esi:remove>"])` | `() => ""` |
| `<esi:comment text="..."/>` | `searchStrategyFactory(["<esi:comment", "/>"])` | `() => ""` |
| `<esi:vars>...</esi:vars>` | `searchStrategyFactory(["<esi:vars>", "</esi:vars>"])` | strip wrappers, resolve variables in body |

#### Pass 2 — ESI comment reveal (`OptimisticPairTransformEngine`)

```ts
new OptimisticPairTransformEngine({
  openStrategy:  searchStrategyFactory(["<!--esi"]),
  closeStrategy: searchStrategyFactory(["-->"]),
  concurrencyStrategy: new SemaphoreStrategy(Infinity),
  replacement: async (innerStream) => applyFullPipeline(innerStream, context, options)
  // returns AsyncIterable<string> — NOT nested(), because the full pipeline is
  // explicitly constructed here, not re-applied via the engine's own config
})
```

Content between the anchors is streamed through the full ESI pipeline immediately — no
buffering until `-->` is found.

#### Pass 3 — Async evaluation and fetch (`AsyncLookaheadTransformEngine`)

| Tag | Strategy | Notes |
|---|---|---|
| `<esi:choose>` Level A | `BalancedPairSearchStrategy(["<esi:choose", "</esi:choose>"])` | Buffer full block, evaluate `<esi:when test="">` in order, emit winning branch via `nested()` |
| `<esi:include>` src resolve | `searchStrategyFactory(["<esi:include", "/>"])` | Sync pre-pass: resolve `$(...)` in `src=` only, pass tag through |
| `<esi:include>` fetch | `searchStrategyFactory(["<esi:include", "/>"])` | Async: fetch resolved URL, pipe response through `applyFullPipeline()` up to `maxDepth` |

`<esi:choose>` Level B (future optimisation): streaming state machine that emits the winning
branch before `</esi:choose>` arrives. A test asserting that `<esi:include>` inside a
winning branch starts fetching before `</esi:choose>` is found is written at Milestone 3
and marked `todo` until Level B is implemented.

---

### Repo structure

```
esi-transformer/
├── src/
│   ├── index.ts                         # re-exports esi10 preset as default
│   ├── types.ts                         # FetchFn, EsiRequestContext, EsiOptions, EsiIncludeContext
│   ├── presets/
│   │   ├── varnish.ts                   # Tier 1
│   │   └── esi10.ts                     # Tier 2
│   ├── pipeline/
│   │   ├── index.ts                     # applyFullPipeline() — composes all passes
│   │   ├── sync-tags.ts                 # Pass 1: remove, comment, vars
│   │   ├── esi-comment.ts               # Pass 2: <!--esi--> via OptimisticPairTransformEngine
│   │   └── async-tags.ts                # Pass 3: choose + include
│   ├── tags/
│   │   ├── remove.ts
│   │   ├── comment.ts
│   │   ├── vars.ts
│   │   ├── choose.ts
│   │   └── include.ts
│   └── variables/
│       ├── resolver.ts                  # ESI variable resolution
│       └── expression.ts               # ESI expression evaluator (for esi:when test=)
├── test/
│   ├── unit/
│   │   ├── variables/
│   │   │   ├── resolver.test.ts
│   │   │   └── expression.test.ts
│   │   └── tags/
│   │       ├── esi-comment.test.ts
│   │       ├── remove.test.ts
│   │       ├── comment.test.ts
│   │       ├── vars.test.ts
│   │       ├── choose.test.ts
│   │       └── include.test.ts
│   ├── cross-chunk/
│   │   └── boundary.test.ts
│   └── integration/
│       ├── varnish-preset.test.ts
│       ├── esi10-sync.test.ts
│       ├── esi10-preset.test.ts
│       └── runtime-compat.test.ts
├── benchmarks/
│   ├── in-process/
│   │   ├── vitest.config.js
│   │   └── throughput.bench.ts
│   └── docker/
│       ├── docker-compose.yml
│       ├── backend/                     # Static Bun/Node fixture server
│       ├── varnish/
│       │   └── default.vcl
│       ├── akamai-ets/                  # Config + README for manual Docker pull
│       ├── rct-bun/                     # Bun server using esi-transformer
│       ├── rct-node/                    # Node server using esi-transformer
│       └── k6/
│           ├── scenarios.js
│           └── fixtures/                # HTML pages with varying ESI complexity
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── build.js
└── vitest.config.ts
```

---

### TDD milestones

All milestones follow strict TDD: write failing tests first, then implement until green.

---

#### Milestone 1 — Varnish preset

**`test/unit/tags/esi-comment.test.ts`**
- `<!--esi content -->` — anchors stripped, `content` emitted
- Content emitted before `-->` arrives (inner stream starts flowing immediately)
- Multiple `<!--esi...-->` blocks in one document
- `<!--esi` split across chunks: `<!-` / `-esi`
- `-->` split across chunks: `--` / `>`
- `<!--esi` at very end of stream (no `-->`) — content flushed

**`test/unit/variables/resolver.test.ts`**
- `$(REQUEST_PATH)` → request path
- `$(QUERY_STRING)` → full query string
- `$(QUERY_STRING{key})` → single param value; missing key → `""`
- `$(HTTP_COOKIE{name})` → cookie value; missing → `""`
- `$(HTTP_HOST)`, `$(HTTP_REFERER)`, `$(HTTP_USER_AGENT)`, `$(HTTP_ACCEPT_LANGUAGE)`
- Unknown variable → `""`
- Multiple variables in one string

**`test/unit/tags/include.test.ts`**
- `<esi:include src="/path"/>` — fetch called with correct URL, body streamed to output
- Relative `src=` — resolved against including document's URL
- `onerror="continue"` — 4xx/5xx yields `""`
- `onerror="continue"` — network error yields `""`
- `onerror="throw"` (or default) — error propagates, stream aborts
- `src=` with ESI variable — variable resolved before fetch
- Depth at `maxDepth` — include stripped, no fetch
- `<esi:include` split across chunks
- `src="..."` attribute value split across chunks

**`test/cross-chunk/boundary.test.ts`**
- `<!--esi` split: `<!-` / `-esi content -->`
- `-->` split: `<!--esi content -` / `->`
- `<esi:include` split: `<esi:inc` / `lude src="/x"/>`
- `src=` value split: `src="/pa` / `th"/>`

**`test/integration/varnish-preset.test.ts`**
- Document with no ESI tags — passes through unchanged
- Single `<!--esi <esi:include src="/a"/> -->`
- Multiple sequential includes — fetched concurrently, emitted in source order
- Nested: `<!--esi...-->` revealing an include; fragment has its own `<!--esi...-->`
- Include depth 2: A includes B includes C (within maxDepth)
- Include at maxDepth — not fetched
- Mock fetch delay — earlier include in source order emitted first even if slower

---

#### Milestone 2 — ESI 1.0 sync tags

**`test/unit/tags/remove.test.ts`**
- `<esi:remove>content</esi:remove>` — content stripped
- Self-closing `<esi:remove/>` — stripped
- Nested `<esi:remove>` — balanced, inner content stripped
- Cross-chunk: `<esi:rem` / `ove>content</esi:remove>`
- Adjacent `<esi:remove>` blocks

**`test/unit/tags/comment.test.ts`**
- `<esi:comment text="foo"/>` — stripped, no output
- Attribute variations: `text='foo'`, text with spaces

**`test/unit/variables/expression.test.ts`**
- `$(X) == 'value'` — true when match
- `$(X) != 'value'` — true when no match
- `$(X) matches 'pattern'` — regex match, case-sensitive
- `$(X) matches_i 'pattern'` — regex match, case-insensitive
- Truthy: non-empty string resolves to true
- Falsy: empty string resolves to false
- Invalid regex in `matches` — evaluates to false (no throw)
- Nested variable in expression: `$(HTTP_COOKIE{a}) == '$(QUERY_STRING{b})'`

**`test/unit/tags/vars.test.ts`**
- `<esi:vars>$(REQUEST_PATH)</esi:vars>` — wrappers stripped, variable resolved
- Variables outside `<esi:vars>` — NOT resolved (pass through as-is)
- Multiple variables in one `<esi:vars>` block
- Cross-chunk: `<esi:vars>` split, variable reference split

**`test/integration/esi10-sync.test.ts`**
- `<esi:remove>` inside `<!--esi...-->` — removed after reveal
- `<esi:vars>` inside `<!--esi...-->` — variables resolved after reveal
- `<esi:comment>` alongside `<esi:include>` — comment stripped, include fetched

---

#### Milestone 3 — `esi:choose` (async, Level A)

**`test/unit/tags/choose.test.ts`**
- First matching `<esi:when>` wins; subsequent `when` blocks not evaluated
- `<esi:otherwise>` emitted when no `when` matches
- No match, no `otherwise` → empty output
- Nested `<esi:choose>` inside winning branch
- `<esi:include>` inside winning branch — fetched
- Non-winning branch contains `<esi:include>` — NOT fetched
- `<esi:when test="">` with each expression type

**`test/unit/tags/choose-cross-chunk.test.ts`**
- `<esi:choose>` split: `<esi:ch` / `oose>`
- `<esi:when test="` split mid-attribute
- `test="..."` value split
- `</esi:choose>` split

**`test/unit/tags/choose-streaming.test.ts`** *(Level B — marked `todo` until streaming state machine is implemented)*
- `<esi:include>` inside winning branch begins fetching before `</esi:choose>` arrives in the stream

---

#### Milestone 4 — Full ESI 1.0 integration

**`test/integration/esi10-preset.test.ts`**
- Full document with all Tier 2 tags: `<!--esi-->`, `remove`, `vars`, `choose`, `include`
- `<esi:vars>` inside an included fragment — resolved with fragment's context
- `<esi:choose>` inside an included fragment
- `includeContext: { requestPath: 'fragment' }` — `$(REQUEST_PATH)` in fragment = fragment path
- `includeContext: { requestPath: 'origin' }` — `$(REQUEST_PATH)` in fragment = origin path
- `includeContext: { queryString: 'merged' }` — fragment params merged over origin
- `includeContext: { queryString: 'fragment' }` — only fragment params visible
- Recursive include: A → B → C, each with `<esi:vars>` using correct context
- `maxDepth` respected across all levels

**`test/integration/runtime-compat.test.ts`**
- Full `esi10` preset integration test suite run under Node, Bun, Deno via separate vitest
  pool entries or CI matrix

---

#### Milestone 5 — Benchmarks

**In-process (`benchmarks/in-process/throughput.bench.ts`)**

Fixture set:
- `small.html` — 4 KB, 2 includes, 1 choose block
- `medium.html` — 40 KB, 10 includes, 3 choose blocks, depth-2 nesting
- `deep.html` — 8 KB, depth-4 include chain

Subjects (all using mock fetch returning static fragments):
- `esi-transformer` varnish preset
- `esi-transformer` esi10 preset
- `@fastly/esi`
- Naive sequential `string.replace` baseline

Metrics: ops/sec, P50/P95 latency, time to first emitted chunk (TTFB proxy).

**Docker suite (`benchmarks/docker/`)**

```yaml
# docker-compose.yml services:
backend:     Static Bun server — fixture HTML pages with ESI tags
varnish:     Varnish 7, ESI-enabled VCL, port 8081
akamai-ets:  Akamai ETS image, port 8082
             NOTE: requires manual docker pull — see benchmarks/docker/akamai-ets/README.md
fastly-node: Node proxy using @fastly/esi, port 8083
rct-bun:     Bun server using esi-transformer, port 8084
rct-node:    Node server using esi-transformer, port 8085
k6:          k6 runner
```

k6 scenarios:
- `warm-throughput` — 100 VUs × 30s, backend responses cached
- `cold-ttfb` — sequential requests, measure time to first byte
- `deep-nesting` — fixture with depth-3 include chain
- `high-include-count` — fixture with 20 includes per page

Output: Markdown summary table per scenario — req/s, P50/P95/P99 latency, TTFB.

CI policy: Docker suite behind manual `workflow_dispatch` trigger. In-process benchmarks
run on every PR.

---

### Dependency and ordering constraints

```
Phase 1 PR merged and published
  └─ esi-transformer repo created
       └─ Milestone 1 (Varnish preset — TDD)
            └─ Milestone 2 (Sync tags — TDD)
                 └─ Milestone 3 (esi:choose Level A — TDD)
                      └─ Milestone 4 (Full integration — TDD)
                           └─ Milestone 5 (Benchmarks)
```

Milestone 3 `choose-streaming.test.ts` (`todo`) may be promoted to a passing milestone
independently of the above sequence once the Level B streaming state machine is designed.
