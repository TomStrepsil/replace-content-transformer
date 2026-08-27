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

- **anything not identifiably a `SearchStrategy`.** `flush(): string` is an ordinary name on cache, logger, stream and database APIs, and neither codemod will touch one. An implementation qualifies by its class `implements SearchStrategy<…>` or `extends …StrategyBase<…>`; a call site qualifies by its receiver being named for a strategy (`strategy`, `this.searchStrategy`). A strategy that satisfies the interface structurally, without saying so, is reported rather than rewritten
- `flush` implementations that compose the result from several sources (`return flushed + this.inner.flush(state)`), or whose return type is not `string`
- call sites where the result flows somewhere structural: returned, awaited, concatenated, stored on a field, or passed straight as an argument
- call sites where the tail is not read by the statements immediately following, or is read again after an unrelated one — moving a statement into the drain loop would run it once per result
- dynamic dispatch (`strategy[name](state)`)
- type-only declarations of the interface (`flush: (state: S) => string`), since the correct replacement type depends on your `TMatch`

Each skip prints a file and line to migrate by hand.

## What they get right that is easy to get wrong

- **The match type is taken from your class, not assumed.** `implements SearchStrategy<State, RegExpExecArray>` produces `Generator<MatchResult<RegExpExecArray>, void, undefined>`, not `MatchResult<string>`. Where the rewritten signature needs a `MatchResult` import you do not already have, that is reported.
- **A `return` that was not in tail position still ends the generator.** `if (cached) return cached; return state.buffer;` becomes a `yield` followed by `return;`, rather than a generator that yields both.
- **`return`s inside nested callbacks are left alone.** Only the `flush` method's own returns are rewritten; a `return` inside a `map` or `forEach` argument belongs to that function.
- **The drain loop variable cannot shadow.** Where `result` is already bound in scope, the loop uses `result2`, and so on.
