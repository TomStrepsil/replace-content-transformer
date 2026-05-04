# Benchmarks

This workspace contains performance benchmarking tools.

### Algorithm Benchmarks

Compare different search strategy implementations:

```bash
# Run algorithm comparison (human-readable output)
npm run bench:algorithms

# Generate JSON output
npm run bench:algorithms:json

# Generate succinct JSON results file, for visualisation
npm run bench:algorithms:json:succinct

# Visualise existing results
npm run bench:algorithms:visualise -- --json algorithm/results/{succinct output file}
npm run bench:algorithms:visualise -- --json algorithm/results/{succinct output file} -- --html > chart.html
npm run bench:algorithms:visualise algorithm/results/*.json -- --timeseries -- --html > chart.html
```

#### What's Measured

Performance characteristics of different search algorithms (buffered-indexOf, looped-indexOf, KMP, regex, etc.) for finding patterns in streaming content. Many strategies are limited by design, providing a baseline for more advanced capability. [^1]

The "setup cost" of each scenario is benchmarked independently, showing the overhead of one-time creation of search strategies. This cost is assumed amortized when consumed, via re-usability to multiple streams. The production strategies are designed to be "stateless", on this basis.

Other reference algorithms "stateful" such that construction cost is included in each benchmark run against a streaming scenario.

See example output of `npm run bench:algorithms:visualise`:

```shell
System: Apple M4 (arm64-darwin)
Runtime: node 24.9.0

1. Setup Cost (strategy + transformer creation)
    Buffered IndexOf + Anchor Sequence   ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 32.21 ns
    Buffered IndexOf Anchored (Async)    █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 15.28 ns
    Buffered IndexOf Anchored Callback   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 6.27 ns
    Buffered IndexOf Anchored            █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 15.28 ns
    Buffered IndexOf Callback            ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 7.69 ns
  ★ Buffered IndexOf Canonical           ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0.28 ns
    Buffered IndexOf Generator Canonical ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 7.91 ns
    KMP + Anchor Sequence                ███░░░░░░░░░░░░░░░░░░░░░░░░░░░ 53.62 ns
    Looped IndexOf + Anchor Sequence     ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 31.08 ns
    Looped IndexOf Callback              ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 7.86 ns
    Regex + Anchor Sequence              ██████████████████████████████ 550.02 ns
    Regex Callback                       █████████████████████░░░░░░░░░ 380.96 ns
    Regex-Canon                          █████████████████████████████░ 532.75 ns
    Regex                                ██████████████████████████░░░░ 483.34 ns
```

Default [`mitata`](https://github.com/evanwashere/mitata) output is also available via `npm run bench:algorithms`:

```shell
benchmark                           avg (min … max) p75 / p99    (min … top 1%)
--------------------------------------------------- -------------------------------
• Setup Cost (strategy + transformer creation)
--------------------------------------------------- -------------------------------
Buffered IndexOf + Anchor Sequence    38.58 ns/iter  39.00 ns    ▅█
                             (34.36 ns … 192.83 ns)  48.15 ns    ██
                            (307.45  b … 811.08  b) 546.40  b ▁▁▁██▇▆▆▃▂▂▁▆▂▂▂▂▁▁▁▁

Buffered IndexOf Anchored (Async)     24.19 ns/iter  23.88 ns    █
                             (21.48 ns … 136.36 ns)  33.58 ns    █
                            (147.24  b … 537.64  b) 304.31  b ▁▁▁█▃▂▂▂▂▁▁▁▁▁▂▁▁▁▁▁▁
...
```

### Output Formats

- Human-readable: Relative performance with ops/sec (default mitata output)
- JSON: Detailed timing data for further analysis
- Succinct: Saved to `algorithm/results/comparison-YYYY-MM-DD.json` (for trending and HTML output)
- HTML (produced from "succinct" output)
  - Allowing selection of strategies to compare against each other on a per-run basis
  - Timeseries output to show changes in performance after code changes

[^1]: N.B. only `regex` and `looped-indexOf-anchored` strategies are exported, with full required functionality.

### AsyncIterable Strategy Benchmarks

Compare concurrency strategies for `LookaheadAsyncIterableTransformer` against the serial `AsyncReplaceContentTransformer` baseline:

```bash
# Run all scenarios (30 RCBD blocks — completes in ~1 s)
npm run bench:lookahead-strategies

# Run with Gantt-chart timeline appended to each scenario
npm run bench:lookahead-strategies:timeline

# Single scenario
npm run bench:lookahead-strategies:scenario -- Uniform

# Override concurrency dial (default: 4)
./strategy/run.sh --concurrency 8
```

#### Subjects

| ID | Label | Description |
|----|-------|-------------|
| A  | Serial (A) | `AsyncReplaceContentTransformer` — sequential, manual nesting via recursive child transformers |
| A' | Lookahead serial c=1 (A') | `LookaheadAsyncIterableTransformer` with `SemaphoreStrategy(1)` — lookahead scanner, serial dispatch |
| B  | Lookahead semaphore c=N (B) | `LookaheadAsyncIterableTransformer` with `SemaphoreStrategy(N)` — FIFO concurrent dispatch |
| C  | Lookahead streamOrder c=N (C) | `LookaheadAsyncIterableTransformer` with `PriorityQueueStrategy(N, streamOrder)` — prioritises slots that are earlier in the output stream |
| D  | Lookahead breadthFirst c=N (D) | `LookaheadAsyncIterableTransformer` with `PriorityQueueStrategy(N, breadthFirst)` — dispatches shallower tree nodes before deeper ones |

#### Scenarios

| Name | Description | Key insight |
|------|-------------|-------------|
| Uniform | 20 matches × 50 ms | B/C/D ≈ 4× faster than A/A' at c=4 |
| Slow-head | Match 0: 500 ms; matches 1–19: 20 ms | Head blocks output for all strategies; B/C/D still win on total time |
| Jittered | 40 matches, log-normal latency (median 40 ms) | Parallel dispatch absorbs tail latencies; CV of inter-chunk gaps reveals burstiness |
| Nested-wide | 8 outer × 4 inner matches; `Nested` re-scanning | A uses recursive child transformers (README pattern); B/C/D use the engine's native `nested()` support; all show 4× speedup over A/A' |
| Nested-streaming | 8 outer × 6 inner with slow input chunks (chunkDelay 30 ms); pinned c=3 | Forces B vs D divergence: B (FIFO) dispatches queued inner children before later-arriving outer slots; D (breadthFirst) promotes the shallower outer, keeping the outer pipeline moving — same totalMs, lower maxGap for D |
| `*-body` variants | TTFB + streaming-body split (10% / 90%, 5 chunks) of Uniform / Slow-head / Jittered / Nested-wide | Stretch slot occupancy across body emission to exercise "in-flight, not just initiation" semantics. `inFlight` column confirms the bound is honoured. Drain serialisation usually dominates totalMs; maxGap drops as output is smoothed across body chunks |

#### Streaming-body variants

Each base scenario has a `*-body` companion that moves 90% of the per-match latency from the pre-iterable `await delay()` (TTFB) into per-chunk awaits inside the returned generator. Total per-match work is unchanged; the slot is now held across the entire body emission rather than released the moment the iterable is returned.

This exercises the new in-flight semantics introduced when concurrency was bounded by *concurrent iterables alive* rather than dispatch initiation. The `inFlight` column verifies the bound is enforced (≤ N at all times).

Counter-intuitively, totalMs typically *increases* under streaming bodies because the in-order drainer pulls one slot's iterable at a time — body emission pace becomes drain pace, eroding parallelism gains. This is a property of in-order delivery, not the strategy. maxGap conversely drops, because output is smeared across body chunks rather than emitted in single bursts.

#### When do C and D differ from B?

On **flat** scenarios all three strategies are equivalent — there is no slot tree to order, so the priority queue degenerates to arrival order.

Differences surface on **nested** scenarios where the replacement returns a [`Nested`](../../src/lookahead/nested.ts) sentinel, creating a tree of child slots:

- **B (FIFO)** dispatches in scan-arrival order — inner slots from early outer matches compete with later outer slots in the order they were scheduled.
- **C (streamOrder)** prioritises the slot whose output appears earliest in the stream. In a nested tree this means a child slot of outer-0 outranks outer-1, so earlier sections' content completes sooner — lower maxGap for the first sections, at the cost of stalling later outer slots.
- **D (breadthFirst)** processes all slots at a given tree depth before descending — outer slots always take precedence over their own children. Best when wide independent branches should all start work simultaneously before any inner work begins.

The `--timeline` flag makes these differences visible as a Gantt chart: each replacement is drawn as a horizontal bar on a shared virtual-time axis, with chunk-emission markers (`▾`) beneath.

#### What's Measured

- `total` — median total run time across RCBD blocks
- `maxGap` — median of the worst inter-chunk gap per run (output smoothness)
- `CV` — coefficient of variation of inter-chunk gaps (σ/μ); higher = burstier output
- `inFlight` — median of the peak number of replacement iterables alive simultaneously per run; verifies the `ConcurrencyStrategy` bound (≤ configured concurrency)

Timing uses Vitest fake timers (`vi.useFakeTimers` + `vi.runAllTimersAsync`): `setTimeout` and `performance.now` are intercepted so runs complete in near-zero wall-clock time while preserving the concurrency semantics that make the benchmark meaningful (semaphore slots are held for the full simulated delay).

#### Example output

```
═════════════════════════════════════════════════════
Scenario: Uniform  (20 matches × 50 ms uniform latency, concurrency=4, 30 blocks)
═════════════════════════════════════════════════════
Subject                            total   maxGap      CV inFlight
─────────────────────────────────────────────────────
Serial (A)                       1000 ms    50 ms    1.41        1
Lookahead serial c=1 (A')        1000 ms    50 ms    1.41        1
Lookahead semaphore c=N (B)       250 ms    50 ms    3.31        4
Lookahead streamOrder c=N (C)     250 ms    50 ms    3.31        4
Lookahead breadthFirst c=N (D)    250 ms    50 ms    3.31        4
═════════════════════════════════════════════════════
Drift-corrected ratios vs Serial (A) (within-block, 95% bootstrap CI on median ratio):
  Lookahead serial c=1 (A')       1.000  [1.000–1.000]
  Lookahead semaphore c=N (B)     0.250  [0.250–0.250]
  Lookahead streamOrder c=N (C)   0.250  [0.250–0.250]
  Lookahead breadthFirst c=N (D)  0.250  [0.250–0.250]
═════════════════════════════════════════════════════

Timeline: Uniform  (representative run per subject)

  Serial (A)  1000 ms
      0 ▕▾██▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
      1 ▕░░░▾██▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
    ...

  Lookahead semaphore c=N (B)  250 ms
      0 ▕▾███████████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
      1 ▕▾███████████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
      2 ▕▾███████████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
      3 ▕▾███████████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
      4 ▕░░░░░░░░░░░░▾███████████▾░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▏
    ...
      ╰┴──────────────┴──────────────┴──────────────┴──────────────┴
      0 ms          63 ms          125 ms         188 ms         250 ms
```

### Runtime Benchmarks

Compare performance across different JavaScript runtimes (Node.js, Bun, Deno):

```bash
# Run on default runtime (Node.js)
npm run bench

# Run on specific runtimes (if available...)
npm run bench:node
npm run bench:bun
npm run bench:deno

# Run on all installed runtimes
npm run bench:runtimes

# Compare all runtimes
npm run bench:compare-runtimes
```

#### What's Measured

Stream processing performance with the same code across different JavaScript engines:

- Stream processing throughput (operations per second)
- Transformer overhead
- Async vs sync performance

## Development

### Adding New Algorithm Benchmarks

1. Add strategy to `../../src/search-strategies/benchmarks/`
2. Create harness in `../../test/harnesses/`
3. Import and add to `algorithm/comparison.bench.ts`
4. Run `npm run bench:algorithms` to verify

### Adding New Runtime Benchmarks

1. Add scenario to `runtime/benchmark-definitions.ts`
2. Update `runtime/benchmarks.ts` if needed
3. Run on each runtime to verify compatibility

## Notes

- Algorithm benchmarks focus on **algorithmic differences** (same runtime, different approaches)
- Runtime benchmarks focus on **engine differences** (same code, different engines)
- All benchmarks run in the workspace context with access to `../../src/` for imports
- Node scripts use `node --import tsx`, so local TypeScript execution resolves source `.ts` files behind `.js` import specifiers without a prebuild
