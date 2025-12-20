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
- Scripts use `--experimental-strip-types` for TypeScript execution without compilation
