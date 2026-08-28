# v3 → v4: `flush()` yields `MatchResult`s

`SearchStrategy.flush(state)` returned a `string`. It now returns a generator of the same `MatchResult` union `processChunk` yields:

```ts
// v3
flush(state: TState): string;

// v4
flush(state: TState): Generator<MatchResult<TMatch>, void, undefined>;
```

This is what lets a strategy defer a decision at a chunk boundary and still report a real match once the stream ends — the fix for [#54](https://github.com/TomStrepsil/replace-content-transformer/issues/54).

## These report; they do not edit

Both tools **find and explain**, and leave every file untouched. Run them in either order, on anything:

```bash
npm run report:flush-implementations -w codemods -- path/to/src
npm run report:flush-call-sites -w codemods -- path/to/src
```

Rewriting this migration mechanically turns out to be where the risk is, not where the work is. A `flush(): string` might belong to a cache; a `return` inside a nested callback is not the method's own; a `return` that was not in tail position still has to end the generator; an empty buffer must not yield an empty result; a drain loop must not absorb a statement that never read the tail, shadow a binding, or delete a sibling declarator. Each of those is a silent edit to someone's source if the analysis is wrong by one case.

The analysis itself is worth keeping — where the sites are, what the new signature is, what each `return` becomes. That is what these print.

## 1. Implementations

```
src/token-strategy.ts:4: flush(state: TokenState): string
    becomes *flush(state: TokenState): Generator<MatchResult<RegExpExecArray>, void, undefined>
    line 5: `return state.cached` becomes `const flushed = state.cached; if (flushed) yield { isMatch: false, content: flushed };`, then `return;` to end the generator
    line 8: `return flushed` becomes `if (flushed) yield { isMatch: false, content: flushed }`
src/token-strategy.ts: add a type import for MatchResult
```

What it works out for you:

- **The match type, from your class.** `implements SearchStrategy<State, RegExpExecArray>` gives `MatchResult<RegExpExecArray>`. The position differs by clause: `SearchStrategy<TState, TMatch>` names the match type second, so `implements SearchStrategy<State>` leaves it at the interface's `string` default, while `StringBufferStrategyBase<TMatch>` names it first. A class extending a *concrete* strategy (`extends RegexSearchStrategy`) inherits a match type this file cannot see, so the report says so instead of guessing `string`.
- **Which returns are yours.** A `return` inside a `map` or `forEach` callback belongs to that function and is not listed.
- **Which returns need a terminator.** Only a `return` outside tail position has to be followed by `return;`.
- **Where the guard goes.** v3 returned `""` for an empty buffer and consumers skipped it, so the `if` is not decoration. Anything but a plain binding is bound first, so the guard cannot evaluate the expression twice.
- **Delegation.** `return this.inner.flush(state)` becomes `yield* this.inner.flush(state)`.

Strategies that inherit `flush` from `StringBufferStrategyBase` need no change, and are not listed.

## 2. Call sites

```
src/engine.ts:1: this.searchStrategy.flush(this.state) now yields results rather than a string. To keep the current bytes:
    for (const result of this.searchStrategy.flush(this.state)) {
      const tail = result.isMatch
        ? this.searchStrategy.matchToString(result.content)
        : result.content;
      // …the statements that used `tail`, unchanged
    }
    A match settling here is the point of the change — decide whether to replace it.
```

The loop is written for the names actually in use, and is deliberately the **behaviour-preserving** migration: every result stringified, the same bytes out. What a replacement should do with a match that settles at end of stream is a decision only the consumer can make, so it is named rather than taken.

## What they stay quiet about

`flush()` is an ordinary name on cache, logger, stream and database APIs. Neither tool mentions one:

- an implementation qualifies by its class `implements SearchStrategy<…>` or `extends …StrategyBase<…>`
- a call site qualifies by its receiver being named for a strategy (`strategy`, `this.searchStrategy`)

A strategy that satisfies the interface structurally, without saying so, will not be found — search for `flush` by hand if you have one. Already-migrated code (a generator `flush`, a `for…of` over `flush()`) is silent too, so a second run after migrating should print nothing.
