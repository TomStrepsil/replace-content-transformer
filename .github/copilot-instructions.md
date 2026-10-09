# Code review instructions

This library is a streaming find-and-replace for WHATWG `TransformStream` and Node `Transform`. Matches must be found correctly no matter how the input is split into chunks. It ships ESM and CJS builds and runs on Node, Bun and Deno.

## Report only issues that change behaviour

Leave a comment only when you can describe concrete input or state that produces wrong output, a crash, a hang, a leak, or a broken public API. Each comment should name that input. If you can't build a failing scenario, don't comment.

Do not comment on:

- Formatting, whitespace, quote style or import order. Prettier isn't used, and ESLint and `tsc` run in CI.
- Missing code comments or JSDoc (unless a new public surface). Production code expresses intent through named constants and helpers, not prose, so don't suggest adding comments.
- Naming, small refactors, or rewording that leaves behaviour unchanged.
- `lib/`, `coverage/`, lockfiles, or Dependabot version bumps.
- Code under `test/benchmarks/`. Benchmark strategies are deliberately lean reference implementations, so missing guards, validation or tests there are intentional.

## Where to look hardest

1. **Chunk boundaries.** A needle, regex match or anchor sequence that is split across two or more chunks, including a split after every character. Look at partial matches carried between chunks, and at text that is held back and must eventually be emitted.
2. **State reset.** After `flush()`, or after a match completes, every field a strategy or engine uses has to be back to its initial value so the instance can be reused.
3. **Regex semantics.** `lastIndex`, sticky and global flags, empty matches, zero-width lookarounds, capture groups and indices, and Unicode surrogate pairs at a chunk edge.
4. **Async and iterator protocol.** `return()` and `throw()` propagation, cancellation, backpressure, and errors raised inside a replacement function or async generator.
5. **Public API and semver.** Changes to exported types or signatures in `src/index.ts`, `src/adapters/web` or `src/adapters/node`. If one is breaking, say so once.
6. **Codemods (`codemods/transforms/`).** Rewrites that touch unrelated code, drop statements or declarators, duplicate side effects, change control flow, or produce invalid TypeScript.
7. **Cross-runtime.** APIs that exist in Node but not in Bun or Deno, or the reverse.

## Tests

Flag a behaviour change that comes without a test proving it, especially one that doesn't use the chunk-split harnesses in `test/`. Don't ask for more tests on code that hasn't changed, unless a reasonable scout-rule addition to the PR is made.

## Format and volume

- One comment per root cause. If the same defect shows up in several places, comment once and list the other locations.
- Keep each comment short: the failing scenario, why it fails, and the smallest fix.
- On a re-review, review only what changed since your last review. Don't raise again anything that was already resolved, answered or deliberately declined.
- If nothing meets this bar, approve with a single sentence instead of inventing low-value feedback.
