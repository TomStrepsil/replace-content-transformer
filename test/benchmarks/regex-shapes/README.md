# Regex Content Shapes

What the regex search strategy costs across content shapes, grouped by what each one forces at a **chunk boundary**.

```bash
npm run bench:regex-shapes           # timing run (mitata)
npm run bench:regex-shapes:report    # buffering + fidelity, no timing
npm run bench:regex-shapes:json      # timing run as JSON
```

## Why this exists separately

The [algorithm suite](../algorithm) measures anchor-shaped content exclusively — `{{`/`}}`, and variants of it. That is the one shape whose match can always settle the moment it completes, because the terminator cannot be consumed by the body. It is a fair benchmark of *scanning*, and a blind spot for everything the strategy does at a boundary when a match is still growing.

Those are the paths that make the strategy chunk-invariant, and they are the ones that cost buffering. This suite exists so a change to them shows up as a number rather than as a surprise.

## Boundary behaviours

Every shape declares which one it exercises, and the timing run groups by it, so a regression is read against shapes that share its behaviour rather than against an average over unrelated ones.

| Behaviour | What the scan does | Buffering |
|---|---|---|
| `settles` | The match completes before the end of the chunk, so it is emitted at once; a match ending exactly on the chunk edge is held like any other | bounded by a match ending on the chunk edge |
| `defers` | The candidate reaches the end of the haystack, so more input could change it; it is held until the next chunk or `flush` resolves it. On a backreference or lookahead pattern a candidate ending earlier defers too when `hitEnd()` reports the partial regex read to the end — a lookahead counts, since what it inspects reaches past the matched text | bounded by the pending match |
| `buffers-to-end` | Nothing can stop the match growing, so the buffer runs to the end of the stream | whole stream |
| `no-match` | Nothing viable anywhere — one partial `exec` per scan position | none |

## Shapes

Beyond the boundary behaviours, the catalogue covers the scan features whose cost is not visible in anchor-shaped content: `d`-flag index rebasing, named groups, backreferences, positive lookaheads, astral characters under the `u` flag, matches ending exactly on a chunk edge, nullable patterns that take the zero-length skip path, and match-dense content that isolates per-match overhead from scanning overhead [^1].

Add one by appending to [`shapes.ts`](./shapes.ts) — the timing run, the report and the grouping all derive from that array.

## The growth curve

A single ratio is misleading for `buffers-to-end` content. The whole buffer is re-scanned from position 0 on every chunk, so cost rises with the **length of the stream**, not as a constant factor. The last group samples several lengths so the shape of that curve is visible:

```
1500 chars (24 chunks)     23.36 µs
3000 chars (47 chunks)     82.43 µs
6000 chars (94 chunks)    322.86 µs
12000 chars (188 chunks)    1.38 ms
24000 chars (375 chunks)    4.99 ms
```

Roughly 4x per doubling: a pattern with no terminator its own body cannot consume (`/\S+/`, `/foo.+/`) is quadratic in stream length.

## The report

[`report.ts`](./report.ts) is the deterministic companion to the timing run: peak buffer per shape, how many matches settled at a boundary versus at `flush`, and whether the streamed result still agrees with a non-streaming `matchAll` over the same input. No timing, so it can be diffed between branches directly.

Zero-length matches are excluded from the reference count — the strategy skips them by design, passing the position through as ordinary non-match content.

```
shape                                            boundary        chunks  matches  flush   ref  peak buf  % held
terminator — /\{\{[^{}]*\}\}/ over a template    settles             24       60      0    60         8     0.5
eager class — /[A-Z]+/ over prose                defers              25       60      0    60         8     0.5
no terminator — /\S+/ over unbroken text         buffers-to-end      24        0      1     1      1500   100.0
no match — /ZZZ\d+/ over prose                   no-match            25        0      0     0         0     0.0
```

## Comparing against another branch

Timing on a laptop drifts over the minutes a suite takes, in one direction, so it reads as a real regression. Check out the baseline in a second worktree, run **both orderings** (A, B, B, A) and take the geometric mean of the two ratios, which cancels monotonic drift. The report needs none of this and can simply be diffed.

Keep the suite identical across both worktrees, or compare only the `src/` under test, since each runs its own copy [^2]. [#27](https://github.com/TomStrepsil/replace-content-transformer/issues/27) tracks replacing this with tooling; until then, any figure quoted from this suite in a PR should say which method produced it.

[^1]: Backreferences cannot use the cheap static partial regex and re-expand the captured value atom by atom; every lookahead candidate costs a second, anchored `exec` against the original pattern before it can settle; astral characters are chunked between whole characters, as a `TextDecoder` delivers them; `/END/` defers regardless of whether anything could extend it.

[^2]: Otherwise a change to the shapes or the driver is measured as if it were a change to the strategy. The drift correction is also a blunt instrument: it cancels a monotonic trend, not a machine that is busy in bursts.
