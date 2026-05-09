# AsyncLookaheadTransformEngine

A protocol-agnostic engine for I/O-bound replacements where the `AsyncSerialReplacementTransformEngine` would stall on each replacement before scanning for the next, even when matches could be processed concurrently.

`AsyncLookaheadTransformEngine` scans ahead and **initiates** later matches' replacement work while earlier ones are still pending, with:

- 🔗 **In-order output** — chunks still emit in source order; a fast later replacement never overtakes a slow earlier one.
- 🚦 **Pluggable concurrency control** — a `ConcurrencyStrategy` decides when (and in what order) queued work is dispatched. Two built-ins:
  - `SemaphoreStrategy(limit)` — FIFO arrival-order, bounded concurrency
  - `PriorityQueueStrategy(limit, comparator)` — heap-backed, tree-aware
- 🪆 **Recursive composition** — opt in per-match via the `nested()` sentinel to re-scan a replacement's output with a child engine sharing the same concurrency budget.

Each engine instance owns its scanning state, so construct a fresh instance per input stream.

The engine is adapter-agnostic. Wrap it in `AsyncReplaceContentTransformer` (from `replace-content-transformer/web`) for WHATWG streams, or `AsyncReplaceContentTransform` (from `replace-content-transformer/node`) for Node `.pipe()` pipelines — same engine options, same semantics.

See the [main README](../../../README.md#-pipelined-async-replacement-with-asynclookaheadtransformengine) for full usage examples covering both WHATWG streams and Node.js pipelines.

## Recursive Replacement

Replacements whose output may itself contain further matches can be re-scanned recursively by returning `nested(source)` instead of the raw source. The engine spawns a child sharing the same search strategy, concurrency strategy, and replacement function — so nested work competes for the same budget and is ordered across nesting levels by the scheduler.

The `replacement` callback receives a `LookaheadReplacementContext` as its second argument: `{ matchIndex, streamIndices, depth }`. `depth` is `0` for top-level matches and increments by `1` per `nested()` level — the natural place to guard against unbounded recursion or vary behaviour by nesting level:

```typescript
import { AsyncReplaceContentTransformer } from "replace-content-transformer/web";
import {
  AsyncLookaheadTransformEngine,
  PriorityQueueStrategy,
  nested,
  streamOrder,
  searchStrategyFactory
} from "replace-content-transformer";

// Earlier-in-output-stream work is prioritised (via LCA in the slot tree).
// depth guards against fetched fragments that themselves contain <esi:include>.
const transformer = new AsyncReplaceContentTransformer(
  new AsyncLookaheadTransformEngine({
    searchStrategy: searchStrategyFactory(["<esi:include", "/>"]),
    concurrencyStrategy: new PriorityQueueStrategy(8, streamOrder),
    replacement: async (match, { depth }) => {
      const { groups: { url } } = /src="(?<url>[^"]+)"/.exec(match)!;
      const res = await fetch(url);
      const body = res.body!.pipeThrough(new TextDecoderStream());
      // Re-scan one level deep; emit verbatim beyond that.
      return depth === 0 ? nested(body) : body;
    }
  })
);
```

See the [full usage examples](../../README.md#-pipelined-async-replacement-with-asynclookaheadtransformengine) in the main README.

### Comparators

- **`streamOrder`** (default) — dispatches earlier-in-output-stream work first, via lowest-common-ancestor in the slot tree. Best when users see output progressively and earlier chunks matter more.
- **`breadthFirst`** — dispatches shallower work before deeper work. Best when you want all level-N sibling requests fired before any level-N+1 begins (e.g. parallel fan-out at the top level).

> **Note:** `breadthFirst` only diverges from `SemaphoreStrategy` (FIFO) when the dispatch queue contains slots at *different depths simultaneously*. With instantly-available input, the scanner queues all top-level matches before any replacement resolves to expose children, so the queue never mixes depths and the two strategies make identical choices. Divergence requires slow-arriving input (so child slots queue up alongside later top-level slots) and a saturated concurrency budget — see the `Nested-streaming` benchmark scenario for a worked example. On flat (non-nested) inputs, `breadthFirst` is always equivalent to FIFO.

Implement `NodeComparator` for custom policies.

## Backpressure and `highWaterMark`

Internally the engine runs two concurrent loops — a **scanner** (driven by each `write()` call as chunks arrive) and a **drainer** (emitting to downstream in stream order) — connected by a bounded queue of slots. The `highWaterMark` option caps how many slots the scanner may buffer ahead of the drainer:

```typescript
new AsyncLookaheadTransformEngine({
  searchStrategy,
  replacement,
  concurrencyStrategy: new SemaphoreStrategy(8),
  highWaterMark: 32 // default
});
```

When the queue is full, scanning suspends; that pauses upstream pulls — so memory use is bounded even if downstream stalls. Concurrency is bounded by the `ConcurrencyStrategy`; queued **output** is bounded by `highWaterMark`.

To opt into unfettered dispatch initiation, use `new SemaphoreStrategy(Infinity)` explicitly.

Pick higher values to absorb burstier input (more pipelining, more memory); lower values to tighten the memory ceiling. `32` covers typical transclusion use-cases - for example, an Akamai EdgeWorkers `responseProvider` is [capped at 50 total sub-requests and 5 parallel](https://techdocs.akamai.com/edgeworkers/docs/resource-tier-limitations) (Basic/Dynamic tier); a 15-fragment document produces roughly 31 queued slots (text and match interleaved), which fits without scanner stalls. Set `highWaterMark` to your platform's sub-request ceiling if your documents routinely approach it, and pair `SemaphoreStrategy` with the platform's parallel limit.

## Slot lifetime

A concurrency slot is held across the **entire active lifetime** of a replacement: from before `await replacement(match)` until the producer pulls the last chunk from the returned `AsyncIterable`. The strategy bounds *concurrent iterables*, not just request initiation.

For a typical `fetch`-based replacement this means:

| Phase | Covered by slot? |
|-------|------------------|
| Initiation (DNS, TCP/TLS, request headers, **TTFB**) | ✅ yes |
| Body streaming (response chunks pulled by the producer) | ✅ yes |
| Released | When the producer iterator reports `done: true` (or throws, or is aborted) |

Two cases release the slot earlier than the body's natural end:

- **`Nested` handoff** — returning `nested(body)` releases the parent's slot at return time. The nested body is re-scanned by a child engine, and each match found within acquires its own slot. This matches "one subrequest = one slot" counting models without double-counting at composition boundaries.
- **Replacement-function rejection** — if `replacement()` throws, the slot is released before the error propagates.

This makes the dial directly map to platform limits like ["max N parallel sub-requests"](https://techdocs.akamai.com/edgeworkers/docs/resource-tier-limitations): set the `SemaphoreStrategy` / `PriorityQueueStrategy` concurrency to N and no more than N replacement iterables will be alive at once.

### Caveats

- **Total-call quotas** (e.g. Akamai's "50 subrequests per worker") are not enforced by the strategy — the slot count caps *parallelism*, not *lifetime totals*. Track your own count from the replacement function and abort via the standard `AbortController` path when the budget is exhausted.
- **Drain-loop serialisation is unchanged** — the in-order drainer still pulls one slot's iterable at a time, so a slow earlier body can hold the entire output stream behind it. This is a property of in-order delivery, independent of slot accounting.
- **Avoid releasing early via `nested()` if you intended the parent's body to count** — `nested()` signals "my part is done; subsequent work is the child's problem." If your replacement is a single fetch whose body should count toward the limit, return the body directly rather than wrapping it in `nested()`.

## Cancellation

### Stream teardown

`AsyncReplaceContentTransformer` honours WHATWG `Transformer.cancel()` through the normal stream-teardown path — it forwards to `engine.cancel?.()` if present. For cancelling pending work (e.g. pending `fetch`es) share an `AbortController` between your replacement function and downstream teardown.

### Stopping new replacements (`stopReplacingSignal`)

When aborted, the **scanner** stops calling `replacement()`. Matches discovered after the signal fires are emitted verbatim via [`SearchStrategy.matchToString`](#matchtostring); any partial match the search strategy had buffered is flushed first so output stays in order. Replacements that were already scheduled before the signal fired run to completion unaffected.

```typescript
const ac = new AbortController();

const engine = new AsyncLookaheadTransformEngine({
  searchStrategy,
  replacement,
  concurrencyStrategy: new SemaphoreStrategy(8),
  stopReplacingSignal: ac.signal
});
```

### Abandoning pending work (`abandonPendingSignal`)

When aborted, **both the scanner and the drain loop** switch mode:

- **Scanner** — stops calling `replacement()`, the same as `stopReplacingSignal`. Matches discovered after the signal fires are emitted verbatim via `SearchStrategy.matchToString`; any buffered partial match is flushed first.
- **Drain loop, queued slot** — the replacement function has returned but the drain loop hasn't started consuming its output yet. The iterable is closed immediately and the raw matched text is emitted in its place.
- **Drain loop, currently draining** — the drain loop has already begun iterating the slot's iterable. It is allowed to run to completion; all replacement chunks are emitted normally. No partial output, no substitution.

```typescript
const ac = new AbortController();

const engine = new AsyncLookaheadTransformEngine({
  searchStrategy,
  replacement,
  concurrencyStrategy: new SemaphoreStrategy(8),
  abandonPendingSignal: ac.signal
});
```

### Combining both signals

`abandonPendingSignal` implies scan-loop bypass — when it fires, the scanner also stops calling `replacement()`, the same as if `stopReplacingSignal` had fired. This is intentional: there is no useful combination where you abandon the backlog but keep scheduling new work. Internally, the engine combines both signals with `AbortSignal.any()` to drive the scan loop.

| Signal | Stops scanning | Abandons pending slots |
|--------|---------------|----------------------|
| `stopReplacingSignal` | ✅ | ❌ — queued slots drain normally |
| `abandonPendingSignal` | ✅ (implied) | ✅ — queued slots substituted with original text |

The two signals can be on separate controllers when you want staged shutdown — stop scanning first, then decide later whether to also abandon the queue:

```typescript
const stopAC = new AbortController();
const abandonAC = new AbortController();

const engine = new AsyncLookaheadTransformEngine({
  searchStrategy,
  replacement,
  concurrencyStrategy: new SemaphoreStrategy(8),
  stopReplacingSignal: stopAC.signal,
  abandonPendingSignal: abandonAC.signal
});

// Later: stop scheduling new replacements, let queue drain normally.
stopAC.abort();

// Even later, if needed: also clear the remaining queue.
abandonAC.abort();
```

Or pass the same controller to both when a single abort should do everything:

```typescript
const ac = new AbortController();
const engine = new AsyncLookaheadTransformEngine({
  ...
  stopReplacingSignal: ac.signal,
  abandonPendingSignal: ac.signal
});

// Later: ac.abort() stops both scanning and draining simultaneously.
```
