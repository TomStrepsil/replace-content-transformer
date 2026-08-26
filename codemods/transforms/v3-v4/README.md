# v3 → v4: `flush()` yields `MatchResult`s

`SearchStrategy.flush(state)` returned a `string`. It now returns a generator of the same `MatchResult` union `processChunk` yields:

```ts
// v3
flush(state: TState): string;

// v4
flush(state: TState): Generator<MatchResult<TMatch>, void, undefined>;
```

This is what lets a strategy defer a decision at a chunk boundary and still report a real match once the stream ends — the fix for [#54](https://github.com/TomStrepsil/replace-content-transformer/issues/54).

Two transforms, because the two sides need opposite treatment. Run in order:

1. `codemod:flush-implementation` — for code that **implements** `SearchStrategy`
2. `codemod:flush-call-site` — for code that **drives** a strategy directly

```bash
npm run codemod:flush-implementation -w codemods -- path/to/src
npm run codemod:flush-call-site -w codemods -- path/to/src
```

## 1. `flush-implementation-to-generator`

Marks the method a generator, rewrites the return type, and turns each `return` into a guarded `yield`:

```ts
// before
flush(state: StringBufferState): string {
  const flushed = state.buffer;
  state.buffer = "";
  return flushed;
}

// after
*flush(state: StringBufferState): Generator<MatchResult<string>, void, undefined> {
  const flushed = state.buffer;
  state.buffer = "";
  if (flushed) yield { isMatch: false, content: flushed };
}
```

Delegation becomes `yield*`:

```ts
return super.flush(state);   // -> yield* super.flush(state);
```

Strategies extending `StringBufferStrategyBase` **without** overriding `flush` need no change — the base class default covers them, and the transform leaves them alone.

## 2. `flush-call-site-to-drain`

The consumer now has to decide what a match at end of stream means, and a codemod cannot know. So it rewrites to **exactly the old behaviour** — every result stringified — and marks the spot:

```ts
// before
const tail = strategy.flush(state);
if (tail) controller.enqueue(tail);

// after
// TODO(v4): flush() now yields matches; apply your replacement here if wanted.
for (const result of strategy.flush(state)) {
  const tail = result.isMatch
    ? strategy.matchToString(result.content)
    : result.content;
  if (tail) controller.enqueue(tail);
}
```

Behaviour-preserving by construction: the same bytes come out, and the *opportunity* to handle matches is flagged rather than taken silently. Anyone who wants end-of-stream replacements — the point of the change — opts in deliberately.

## What they will not attempt

Reported as skipped paths rather than transformed, so nothing is silently mangled:

- `flush` implementations that compose the result from several sources (`return flushed + this.inner.flush(state)`), or whose return type is not `string`
- call sites where the result flows somewhere structural: returned, awaited, concatenated, stored on a field, or passed straight as an argument
- dynamic dispatch (`strategy[name](state)`)
- type-only declarations of the interface (`flush: (state: S) => string`), since the correct replacement type depends on your `TMatch`

Each skip prints a file and line to migrate by hand.
