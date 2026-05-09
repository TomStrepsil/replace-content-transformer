
# Lookahead Engine Benchmarks

Compare concurrency strategies for `AsyncLookaheadTransformEngine` against the serial `AsyncReplaceContentTransformer` baseline:

```bash
# Run all scenarios (30 RCBD blocks — completes in ~3 s with fake timers)
npm run bench:lookahead-engine

# Run with Gantt-chart timeline appended to each scenario
npm run bench:lookahead-engine:timeline

# Single scenario by name (partial match, case-insensitive)
npm run bench:lookahead-engine:scenario -- Uniform
npm run bench:lookahead-engine:scenario -- Nested-wide

# Override concurrency dial (default: 4)
./lookahead-engine/run.sh --concurrency 8
```

## Subjects

| ID | Label | Description |
|----|-------|-------------|
| A  | Serial (A) | `AsyncReplaceContentTransformer` — sequential, manual nesting via recursive child transformers |
| A' | Lookahead serial c=1 (A') | `AsyncLookaheadTransformEngine` with `SemaphoreStrategy(1)` — lookahead scanner, serial dispatch |
| B  | Lookahead semaphore c=N (B) | `AsyncLookaheadTransformEngine` with `SemaphoreStrategy(N)` — FIFO concurrent dispatch |
| C  | Lookahead streamOrder c=N (C) | `AsyncLookaheadTransformEngine` with `PriorityQueueStrategy(N, streamOrder)` — prioritises slots that are earlier in the output stream |
| D  | Lookahead breadthFirst c=N (D) | `AsyncLookaheadTransformEngine` with `PriorityQueueStrategy(N, breadthFirst)` — dispatches shallower tree nodes before deeper ones |

A' vs A isolates the lookahead scanner's effect at serial concurrency: both produce identical output order, but A' pre-scans ahead while a replacement is in flight. On flat scenarios they are equivalent; the advantage of serial subject A is simpler nesting (no engine overhead), while A' reveals the cost of the lookahead scanner itself.

## Scenarios

| Name | Description | Key insight |
|------|-------------|-------------|
| Uniform | 20 matches × 50 ms | B/C/D ≈ 4× faster than A/A' at c=4 |
| Slow-head | Match 0: 500 ms; matches 1–19: 20 ms | Head blocks output for all strategies; B/C/D still win on total time |
| Jittered | 40 matches, log-normal latency (median 40 ms) | Parallel dispatch absorbs tail latencies; CV of inter-chunk gaps reveals burstiness |
| Nested-wide | 8 outer × 4 inner matches; `Nested` re-scanning | A uses recursive child transformers; B/C/D use the engine's native nesting; C shows lower maxGap by draining inner slots of section-0 before later outer slots |
| Nested-streaming | 8 outer × 6 inner with slow input chunks (chunkDelay 30 ms); pinned c=3 | Forces B vs D divergence: B (FIFO) dispatches queued inner children before later-arriving outer slots; D (breadthFirst) promotes the shallower outer — same totalMs, lower maxGap for D |
| `*-body` variants | TTFB + streaming-body split (10% / 90%, 5 chunks) for Uniform / Slow-head / Jittered / Nested-wide | Stretches slot occupancy across body emission. `inFlight` confirms the bound is honoured. totalMs typically rises (drain serialisation erodes parallelism); maxGap falls (output smeared across body chunks rather than burst at iterable-return) |

## Streaming-body variants

Each base scenario has a `*-body` companion that moves 90% of the per-match latency from the pre-iterable `await delay()` (TTFB) into per-chunk awaits inside the returned generator. Total per-match work is unchanged; the slot is held for the full body emission rather than released the moment the iterable is returned.

Counter-intuitively, totalMs typically *increases* under streaming bodies because the in-order drainer pulls one slot's iterable at a time — body emission pace becomes drain pace, eroding the parallelism gains visible in the base scenario. The `inFlight` column verifies the bound is enforced (≤ N at all times).

## When do C and D differ from B?

On **flat** scenarios all three strategies are equivalent — there is no slot tree to order, so the priority queue degenerates to arrival order.

Differences surface on **nested** scenarios where the replacement returns a [`Nested`](../../src/engines/async-lookahead-transform-engine/nested.ts) sentinel, creating a tree of child slots:

- **B (FIFO)** dispatches in scan-arrival order — inner slots from early outer matches compete with later outer slots in the order they were scheduled.
- **C (streamOrder)** prioritises the slot whose output appears earliest in the stream. In a nested tree this means a child slot of outer-0 outranks outer-1, so earlier sections' content completes sooner — lower `maxGap` for the first sections, at the cost of stalling later outer slots.
- **D (breadthFirst)** processes all slots at a given tree depth before descending — outer slots always take precedence over their own children. Best when all outer branches should start concurrently before any inner work begins, keeping the outer pipeline moving.

The `--timeline` flag makes these differences visible as a Gantt chart: each replacement is drawn as a horizontal bar on a shared virtual-time axis, with chunk-emission markers (`▾`) beneath.

## What's Measured

- `total` — median total run time across RCBD blocks (virtual ms; all timing is fake-timer-based)
- `maxGap` — median of the worst inter-chunk gap per run; measures output smoothness
- `CV` — coefficient of variation of inter-chunk gaps (σ/μ); higher = burstier output
- `inFlight` — median peak number of replacement iterables alive simultaneously; verifies the `ConcurrencyStrategy` bound (should be ≤ configured concurrency)

Timing uses Vitest fake timers (`vi.useFakeTimers` + `vi.runAllTimersAsync`): `setTimeout` and `performance.now` are intercepted so runs complete in near-zero wall-clock time while preserving the concurrency semantics that make the benchmark meaningful (semaphore slots are held for the full virtual delay). All timing is therefore deterministic virtual milliseconds rather than wall-clock measurements.

Ratios are within-block medians with a 95% bootstrap confidence interval. The randomised block order exists to stabilise JIT inlining — warm-up passes run before block 0, and the per-block shuffle ensures no subject consistently benefits from being measured first in a warmed state. Because timing is deterministic, there is no hardware drift to cancel.

## Example output

**Uniform** — 20 independent matches, each 50 ms. All three concurrent strategies (B/C/D) reach the theoretical 4× speedup at c=4. C and D are identical to B here — no nested slots to differentiate priority ordering.

```
══════════════════════════════════════════════════════════════════
Scenario: Uniform  (20 matches × 50 ms uniform latency, concurrency=4, 30 blocks)
══════════════════════════════════════════════════════════════════
Subject                            total   maxGap      CV inFlight
──────────────────────────────────────────────────────────────────
Serial (A)                       1000 ms    50 ms    1.41        1
Lookahead serial c=1 (A')        1000 ms    50 ms    1.41        1
Lookahead semaphore c=N (B)       250 ms    50 ms    3.31        4
Lookahead streamOrder c=N (C)     250 ms    50 ms    3.31        4
Lookahead breadthFirst c=N (D)    250 ms    50 ms    3.31        4
══════════════════════════════════════════════════════════════════
Drift-corrected ratios vs Serial (A) (within-block, 95% bootstrap CI on median ratio):
  Lookahead serial c=1 (A')       1.000  [1.000–1.000]
  Lookahead semaphore c=N (B)     0.250  [0.250–0.250]
  Lookahead streamOrder c=N (C)   0.250  [0.250–0.250]
  Lookahead breadthFirst c=N (D)  0.250  [0.250–0.250]
══════════════════════════════════════════════════════════════════
```

Key observations:
- `total`: A and A' both take 1000 ms (20 × 50 ms serial); B/C/D take 250 ms (ceil(20/4) × 50 ms).
- `maxGap`: All subjects show 50 ms — the worst gap between output chunks equals one replacement delay regardless of concurrency, since the in-order drainer is gated by the slowest slot in each wave.
- `CV`: Higher for B/C/D (3.31 vs 1.41) — bursts of 4 chunks arrive together at the end of each wave, then silence while the next wave runs, producing a spiky gap distribution.
- `inFlight`: Confirms B/C/D are running 4 concurrent replacements as intended.
- **Ratios**: 0.250 ≡ 4× speedup. The tight CI `[0.250–0.250]` reflects the deterministic fake-timer environment — no measurement noise.

**Nested-wide** — 8 outer matches returning `Nested`, each expanding to 4 inner matches. Now C departs from B and D:

```
══════════════════════════════════════════════════════════════════
Scenario: Nested-wide  (8 outer × 4 inner matches; outer=100 ms, inner=50 ms — C prioritises
inner over pending outer siblings (higher maxGap mid-stream), concurrency=4, 30 blocks)
══════════════════════════════════════════════════════════════════
Subject                            total   maxGap      CV inFlight
──────────────────────────────────────────────────────────────────
Serial (A)                       2400 ms   814 ms    4.75        1
Lookahead serial c=1 (A')        2400 ms   814 ms    4.75        1
Lookahead semaphore c=N (B)      1680 ms   214 ms    1.79        4
Lookahead streamOrder c=N (C)    1580 ms   114 ms    1.06        4
Lookahead breadthFirst c=N (D)   1680 ms   214 ms    1.79        4
══════════════════════════════════════════════════════════════════
Drift-corrected ratios vs Serial (A) (within-block, 95% bootstrap CI on median ratio):
  Lookahead serial c=1 (A')       1.000  [1.000–1.000]
  Lookahead semaphore c=N (B)     0.700  [0.700–0.700]
  Lookahead streamOrder c=N (C)   0.658  [0.658–0.658]
  Lookahead breadthFirst c=N (D)  0.700  [0.700–0.700]
══════════════════════════════════════════════════════════════════
```

Key observations:
- **C has the lowest `maxGap` (114 ms)**: `streamOrder` dispatches section-0's inner slots before outer-4..7, so section-0's output drains in a smooth wave. B and D treat inner and later-outer slots identically, producing 214 ms stalls while the drainer waits for whichever queued slot arrives first in the wrong position.
- **C is also fastest (1580 ms)**: Earlier dispatch of inner slots means they complete and unblock the drain loop sooner.
- **B and D are identical here**: The lookahead scanner queues all 8 outer slots before any inner slots exist, so both strategies see the same queue state at the moment inner slots are created — depth ordering (D) and FIFO (B) make the same choices.
- **A' is slower than A**: The lookahead scanner pre-queues all 8 outer slots before any replacement completes, so all outer work runs first (t=0–800 ms); inner work only begins afterwards. A processes each outer replacement immediately and begins its inner work before outer-1 even starts, so section content flows steadily rather than in a burst at the end.

**With `--timeline`**, each row is one replacement slot, drawn as a bar across the virtual time axis. Chunk-emission markers (`▾`) show when output became available. This makes the C vs B gap structure visible — under C, section-0's inner slots fire immediately after outer-0, whereas under B they queue behind outer-4..7.

```
  Lookahead streamOrder c=N (C)  1580 ms
    outer:0   ▕▾████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
    inner:0-0 ▕░░░░░▾████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
    inner:0-1 ▕░░░░░▾████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
    outer:1   ▕░▾████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
    ...
```