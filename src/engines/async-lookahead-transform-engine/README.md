# LookaheadAsyncIterableTransformer

A WHATWG `Transformer<string, string>` (and Node `stream.Transform` counterpart) for I/O-bound replacements where the `AsyncIterableFunctionReplacementProcessor` would stall on each replacement before scanning for the next, even when matches could be processed concurrently.

`LookaheadAsyncIterableTransformer` scans ahead and **initiates** later matches' replacement work while earlier ones are still in flight, with:

- 🔗 **In-order output** — chunks still emit in source order; a fast later replacement never overtakes a slow earlier one.
- 🚦 **Pluggable concurrency control** — a `ConcurrencyStrategy` decides when (and in what order) queued work is dispatched. Two built-ins:
  - `SemaphoreStrategy(limit)` — FIFO arrival-order, bounded concurrency
  - `PriorityQueueStrategy(limit, comparator)` — heap-backed, tree-aware
- 🪆 **Recursive composition** — opt in per-match via the `nested()` sentinel to re-scan a replacement's output with a child transformer sharing the same concurrency budget.

Each transformer owns its scanning state, so construct a fresh instance per input stream.

A Node `stream.Transform` counterpart is available from `replace-content-transformer/node` as `LookaheadAsyncIterableTransform` — same options, same semantics, wired for `.pipe()` pipelines.

## Basic Usage

```typescript
import { LookaheadAsyncIterableTransformer } from "replace-content-transformer/web";
import {
  SemaphoreStrategy,
  searchStrategyFactory
} from "replace-content-transformer";

// `<esi:include src="..."/>` replaced with the fetched body — up to 8
// fetches may be in flight at once; output stays in source order.
const transformer = new LookaheadAsyncIterableTransformer({
  searchStrategy: searchStrategyFactory(["<esi:include", "/>"]),
  concurrencyStrategy: new SemaphoreStrategy(8),
  replacement: async (match) => {
    const { groups: { url } } = /src="(?<url>[^"]+)"/.exec(match)!;
    const res = await fetch(url);
    return res.body!.pipeThrough(new TextDecoderStream());
  }
});

const replacedStream = readable
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new TransformStream(transformer));
```

## Recursive Replacement

Replacements whose output may itself contain further matches can be re-scanned recursively by returning `nested(source)` instead of the raw source. The engine spawns a child sharing the same search strategy, concurrency strategy, and replacement function — so nested work competes for the same budget and is ordered across nesting levels by the scheduler:

```typescript
import { LookaheadAsyncIterableTransformer } from "replace-content-transformer/web";
import {
  PriorityQueueStrategy,
  nested,
  streamOrder,
  searchStrategyFactory
} from "replace-content-transformer";

// Earlier-in-output-stream work is prioritised (via LCA in the slot tree).
const transformer = new LookaheadAsyncIterableTransformer({
  searchStrategy: searchStrategyFactory(["<esi:include", "/>"]),
  concurrencyStrategy: new PriorityQueueStrategy(8, streamOrder),
  replacement: async (match) => {
    const { groups: { url } } = /src="(?<url>[^"]+)"/.exec(match)!;
    const res = await fetch(url);
    const body = res.body!.pipeThrough(new TextDecoderStream());
    // Re-scan the fetched body; nested fetches share the same budget of 8.
    return nested(body);
  }
});
```

Returning a plain `AsyncIterable<string>` (no `nested()` wrapper) emits the replacement's chunks verbatim without re-scanning — useful when the fragment body is already trusted content or when you want to terminate recursion.

### Comparators

- **`streamOrder`** (default) — dispatches earlier-in-output-stream work first, via lowest-common-ancestor in the slot tree. Best when users see output progressively and earlier chunks matter more.
- **`breadthFirst`** — dispatches shallower work before deeper work. Best when you want all level-N sibling requests fired before any level-N+1 begins (e.g. parallel fan-out at the top level).

> **Note:** `breadthFirst` only diverges from `SemaphoreStrategy` (FIFO) when the dispatch queue contains slots at *different depths simultaneously*. With instantly-available input, the scanner queues all top-level matches before any replacement resolves to expose children, so the queue never mixes depths and the two strategies make identical choices. Divergence requires slow-arriving input (so child slots queue up alongside later top-level slots) and a saturated concurrency budget — see the `Nested-streaming` benchmark scenario for a worked example. On flat (non-nested) inputs, `breadthFirst` is always equivalent to FIFO.

Implement `NodeComparator` for custom policies.

## Backpressure and `highWaterMark`

Internally the transformer runs two concurrent loops — a **scanner** (driven by `transform()` as chunks arrive) and a **drainer** (emitting to downstream in stream order) — connected by a bounded queue of slots. The `highWaterMark` option caps how many slots the scanner may buffer ahead of the drainer:

```typescript
new LookaheadAsyncIterableTransformer({
  searchStrategy,
  replacement,
  concurrencyStrategy: new SemaphoreStrategy(8),
  highWaterMark: 32 // default
});
```

When the queue is full, scanning suspends; that pauses `transform()`, which in turn suspends upstream pulls — so memory use is bounded even if downstream stalls. Concurrency is bounded by the `ConcurrencyStrategy`; queued **output** is bounded by `highWaterMark`.

To opt into unfettered dispatch initiation, use `new SemaphoreStrategy(Infinity)` explicitly.

Pick higher values to absorb burstier input (more pipelining, more memory); lower values to tighten the memory ceiling at the cost of throughput under load. `32` is a compromise suited to typical fragment-fetch workloads.

## Slot lifetime: in-flight, not just initiation

A concurrency slot is held across the **entire in-flight lifetime** of a replacement: from before `await replacement(match)` until the producer pulls the last chunk from the returned `AsyncIterable`. The strategy bounds *concurrent iterables*, not just request initiation.

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

`LookaheadAsyncIterableTransformer` honours WHATWG `Transformer.cancel()` through the normal stream-teardown path. For cancelling in-flight replacement work itself (e.g. pending `fetch`es), share an `AbortController` between your replacement function and downstream teardown.
