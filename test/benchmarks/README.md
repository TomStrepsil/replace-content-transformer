# Benchmarks

This workspace contains performance benchmarking tools.

- [`references/`](./references/README.md): implementations measured against the shipped code, with the [comparisons](./references/README.md#️-comparisons) they serve
- [`harnesses/`](./harnesses/README.md): one wrapper per shipped or reference implementation, so every one runs through the same scenarios
- `algorithm/`, `regex-shapes/`, `runtime/`, `lookahead-engine/`: the suites below

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

Each harness runs in every scenario, and the human-readable run ends with a summary per comparison in [`algorithm/comparisons.ts`](./algorithm/comparisons.ts): how much faster or slower each harness is than that comparison's baseline, as a geometric mean over the scenarios, with the range. See [Comparisons](./references/README.md#️-comparisons) for what each one holds fixed.

The "setup cost" of each scenario is benchmarked independently, showing the overhead of one-time creation of search strategies. This cost is assumed amortized when consumed, via re-usability to multiple streams. The production strategies are designed to be "stateless", on this basis.

Other reference algorithms "stateful" such that construction cost is included in each benchmark run against a streaming scenario.

See example output of `npm run bench:algorithms:visualise`:

```shell
System: Apple M4 (arm64-darwin)
Runtime: node 24.20.0

1. Setup Cost (strategy + transformer creation)
    Balanced Pair                              █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 93.64 ns
    Balanced Pair (regex count)                ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 258.04 ns
    Buffered IndexOf + Anchor Sequence         █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 60.15 ns
  ★ Buffered IndexOf Anchored Callback         ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 4.63 ns
    Buffered IndexOf Anchored                  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 36.35 ns
    Buffered IndexOf Callback                  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 6.03 ns
    Buffered IndexOf Canonical                 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 8.01 ns
    Buffered IndexOf Generator Canonical       ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 9.46 ns
    KMP + Anchor Sequence                      █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 83.83 ns
    Looped IndexOf + Anchor Sequence           █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 74.75 ns
    Looped IndexOf Anchored (Async)            █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 78.16 ns
    Looped IndexOf Anchored (generator engine) █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 55.22 ns
    Looped IndexOf Anchored                    █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 77.90 ns
    Looped IndexOf Callback                    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 5.76 ns
    Regex + Anchor Sequence                    ██████████████████████████████ 2.12 µs
    Regex Callback                             █████████████░░░░░░░░░░░░░░░░░ 942.90 ns
    Regex Canonical                            ███████████████░░░░░░░░░░░░░░░ 1.07 µs
    Regex                                      ███████████████████░░░░░░░░░░░ 1.35 µs
```

Default [`mitata`](https://github.com/evanwashere/mitata) output is also available via `npm run bench:algorithms`:

```shell
benchmark                                 avg (min … max) p75 / p99    (min … top 1%)
--------------------------------------------------------- -------------------------------
• Setup Cost (strategy + transformer creation)
--------------------------------------------------------- -------------------------------
Balanced Pair                               99.52 ns/iter 101.78 ns  █▄
                                   (93.04 ns … 354.11 ns) 117.69 ns  ██▇  █▅▂
                                  (  1.41 kb …   1.75 kb)   1.47 kb █████▇███▆▄▄▃▃▂▂▁▁▁▁▁

Balanced Pair (regex count)                257.73 ns/iter 260.52 ns   █▅▃
                                  (244.41 ns … 361.49 ns) 308.45 ns  ▅███▄
                                  (  1.63 kb …   2.06 kb)   1.81 kb ▃██████▅▄▃▂▂▂▁▁▁▁▁▁▁▁
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

### Regex Content Shape Benchmarks

What the regex search strategy costs across content shapes, grouped by what each forces at a chunk boundary — settling, deferring, buffering to end of stream, or no match at all. See [separate documentation](./regex-shapes/README.md).

```bash
npm run bench:regex-shapes           # timing run (mitata)
npm run bench:regex-shapes:report    # buffering + fidelity, no timing
```

#### What's Measured

The [algorithm benchmarks](#algorithm-benchmarks) above use anchor-shaped content throughout, which is the one shape that can always settle the moment a match completes. This suite covers the rest: eager quantifiers, alternation branches that could still grow, backreferences, `d`-flag indices, astral characters under the `u` flag, nullable patterns, and content with no terminator at all — plus a growth curve showing that the last of those is quadratic in stream length rather than a constant factor.

A deterministic report (`npm run bench:regex-shapes:report`) accompanies the timing run: peak buffer per shape, matches settled at a boundary versus at `settle`, and agreement with a non-streaming reference over the same input.

### Partial Match Length Benchmarks

What [`partialMatchLength`](../../src/search-strategies/looped-indexOf-anchored/partial-match-length.ts), the check `StringAnchorSearchStrategy` makes at the end of each chunk for a partial first anchor, costs at each window size, the last `anchor.length - 1` characters:

```bash
npm run bench:partial-match-length       # Node
npm run bench:partial-match-length:bun   # Bun
```

#### What's Measured

The check looks for the anchor's first character in the window, either by reading each character or with `indexOf`. Each way runs on its own at every window size, next to the shipped check, so the size where `indexOf` starts to pay shows on each runtime. The shipped check reads a one-character window and calls `indexOf` on a longer one, because reading pays beyond one character only on V8.

Each window size runs in a process of its own: on JavaScriptCore, a check that has run one of its branches for earlier sizes is slower when it switches to the other. Chunks come from a `TextDecoder`, as the adapters' do, since V8 reads a sliced string more slowly than a flat one.

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
- Output chunks on match-dense input: each costs every downstream stage, so outside `--json` mode the count for each match-dense scenario is printed before the timings

### Lookahead Engine Benchmarks

Compares concurrency strategies for `LookaheadTransformEngine` against the `SerialTransformEngine` baseline.  See [separate documentation](./lookahead-engine/README.md).

## Development

### Adding New Algorithm Benchmarks

1. Add the implementation to [`references/`](./references/README.md#️-layout): `algorithms/<algorithm>/` for a `SearchStrategy`, or `engine-shapes/<shape>/<algorithm>/` for a different engine shape
2. Create a harness in [`harnesses/`](./harnesses/README.md#adding-a-harness) and export it from its `index.ts`
3. Add the harness to a comparison in `algorithm/comparisons.ts`
4. Run `npm run bench:algorithms` to verify

### Adding New Runtime Benchmarks

1. Add scenario to `runtime/benchmark-definitions.ts`
2. Update `runtime/benchmarks.ts` if needed
3. Run on each runtime to verify compatibility

### Adding New Lookahead Benchmarks

1. Add scenario to `lookahead-engine/scenarios.ts`
2. Update `lookahead-engine/benchmarks.ts` if needed
3. Run on each runtime to verify compatibility

## Notes

- Algorithm benchmarks focus on **algorithmic differences** (same runtime, different approaches)
- Runtime benchmarks focus on **engine differences** (same code, different engines)
- All benchmarks run in the workspace context with access to `../../src/` for imports
- Measuring scripts run JavaScript compiled by `tsc` (`npm run build` in this workspace), on every runtime. Each script builds first, in its `pre` step or, for `algorithm/run.sh` and `runtime/bench-all.sh`, in the script itself, once. Running the TypeScript through `tsx`, Bun or Deno instead measures their transpilers: `tsx`'s `keepNames`, for one, wraps every closure in a `defineProperty` call, which makes creating an engine several times slower than in the published build
- Invoking a benchmark's `.ts` file or its compiled `.js` directly skips that build, so it measures the sources through a transpiler, or stale output
