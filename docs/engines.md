# Engines

An engine runs a [search strategy](./search-strategies.md) over the stream and calls the replacement for each match. Construct one per stream, and wrap it in an [adapter](./adapters.md).

## `SerialTransformEngine`

Replaces each match in full before searching for the next.

```typescript
new SerialTransformEngine({
  searchStrategy,
  replacement,
  stopReplacingSignal? // see Stopping and cancelling
});
```

`replacement` is a `string`, or a function of the match and its context (`matchIndex`, `streamIndices`, `signal`) returning any of:

- a `string`, UTF-8 bytes (`Uint8Array`), or an `Iterable` of strings or bytes, which go straight into the output while the search carries on
- an `AsyncIterable` of strings or bytes, such as a `ReadableStream` or `fetch` body, or a `Promise` of any of these, which pauses the search until fully read

A function can return synchronously for some matches and asynchronously for others ([example](./recipes.md#async-replacement)). An iterable must yield strings or bytes, not Promises: to yield Promises, return an async generator such as `async function* () { yield* promises; }`, which awaits each in turn.

Output arrives in as few chunks as possible. With a `stopReplacingSignal`, a Node consumer gets it piece by piece instead, so it can stop replacements as soon as it sees something (see [Stopping on output](./cancellation.md#stopping-on-output)).

## `LookaheadTransformEngine`

Scans ahead and starts later matches' replacements while earlier ones are still in flight, keeping output in order. A `ConcurrencyStrategy` bounds and orders the work, and `nested()` re-scans a replacement's output. See [`LookaheadTransformEngine`](../src/engines/lookahead-transform-engine/README.md).

## Driving an engine

> [!CAUTION]
> Engines should only be driven by an adapter. Adapters call `write()` and `end()` one at a time, which keeps output in order and buffered text intact.

Need an engine that isn't here, or a change to one? [Raise an issue](https://github.com/TomStrepsil/replace-content-transformer/issues).
