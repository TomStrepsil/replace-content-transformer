# Harnesses

Each harness wraps one search strategy, production or [benchmarking](../../src/search-strategies/benchmarking/README.md), in a common `BaseHarness` shape ([`types.ts`](./types.ts)), so they can all run through the same scenarios:

- `name`, `isAsync`
- `createSearchStrategy({ tokens })` builds the strategy (kept separate so benchmarks can measure setup cost on its own)
- `createTransformer({ strategy, replacement })` returns a `{ transform, flush }` pair
- `skipScenario?(meta)` returns `true` for scenarios the algorithm can't support

[`engine-harness.ts`](./engine-harness.ts) adapts the different implementation styles (sync engine, async engine, callback, generator, legacy transformer) to that `{ transform, flush }` pair.

Every harness exported from [`index.ts`](./index.ts) runs through the scenarios in [`validate-functionality.test.ts`](../benchmarks/algorithm/validate-functionality.test.ts) as part of `npm test`, and is then benchmarked by [`comparison.bench.ts`](../benchmarks/algorithm/comparison.bench.ts).

## Adding a harness

1. Add a harness file here using the matching `engine-harness.ts` adapter.
2. Export it from `index.ts`.
3. Run `npm test` and make sure every validation scenario passes or is skipped deliberately.

## Skipping unsupported scenarios

When a scenario falls outside what an algorithm is designed to handle (e.g. unbalanced delimiters for `BalancedPairSearchStrategy`, or empty chunks for the canonical WHATWG example), don't add special-case code to the strategy to make it pass. Tag the scenario with metadata (`balanced: false`, `noEmptyChunks: true`) and have the harness's `skipScenario` return `true` for it, so the suite skips it via `test.skipIf`. Note why on the harness.
