# Stopping and cancelling

Two signals end replacement, for different reasons:

- **`stopReplacingSignal`**, an engine option you abort, stops replacing: the rest of the stream passes through verbatim.
- **The replacement context's `signal`**, owned by the engine, aborts once a replacement's output is no longer wanted.

`LookaheadTransformEngine` adds `abandonPendingSignal`. See [its cancellation docs](../src/engines/lookahead-transform-engine/README.md#cancellation).

## Stop replacing: `stopReplacingSignal`

Once the signal aborts, the transform is a ["pass through"](https://en.wikipedia.org/wiki/Identity_transform). No replacement is called after that, and one already called runs to completion. To limit the number of replacements:

```ts
const abortController = new AbortController();
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
    replacement: async (match, { matchIndex, signal }) => {
      if (matchIndex === 1) {
        abortController.abort(); // after two replacements, stop replacing
      }
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const response = await fetch(url, { signal });
      return response.ok ? response.body! : match;
    },
    stopReplacingSignal: abortController.signal
  })
);
```

To end an iterable replacement early, have it check the signal between pieces, returning or calling `signal.throwIfAborted()`.

### Stopping requests in flight

To also stop requests already in flight, give `fetch` both signals:

```ts
const abortController = new AbortController();
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
    searchStrategy: new StringAnchorSearchStrategy(["<esi:include", ">"]),
    replacement: async (match, { signal }) => {
      const {
        groups: { url }
      } = /src="(?<url>[^"]+)"/.exec(match)!;
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, abortController.signal])
      });
      return response.ok ? response.body! : match;
    },
    stopReplacingSignal: abortController.signal
  })
);
someEventBus.once("someEvent", () => abortController.abort());
```

A replacement that fails because of an abort ends there instead of erroring the stream. That is, one failing with either signal's `reason`, an `AbortError`, or an error with either in its `cause` chain, such as the error Node's `stream.addAbortSignal` fails with, or one wrapping it. Its match is emitted verbatim if it had produced nothing, and otherwise only what it produced, even part way through a body.

A Node `http.get` given the signal fails that way only until its response arrives, and on Deno only from 2.7.13, whose earlier `node:http` rejects without the `cause`. To end the response part way through too, return `addAbortSignal(signal, response)`.

### Stopping on output

A consumer can abort the signal, or cancel the stream, on seeing some output.

- **WHATWG:** readers, `pipeTo()` and `for await` receive output once the engine has finished with a chunk or is awaiting a replacement, so the abort takes effect from the next chunk, or straight after an awaited replacement that settles after it.
- **Node:** with `SerialTransformEngine` and a `stopReplacingSignal`, output, including each piece of an iterable replacement, is pushed as it is produced. So a `data` listener or `pipe()` destination that aborts or destroys the stream on seeing some output prevents every replacement after it, even within a chunk, and a generator that checks the signal before its next piece sees the abort. This holds only while the consumer keeps up, as Node passes output on straight away only while the stream is flowing with nothing buffered. When a consumer isn't reading yet, reads with `for await`, or is a `pipe()` destination still writing earlier output, later replacements may already have been called.

Where a replacement must never run, decide from the input instead: search for the deciding text too, so the replacement function sees it first, or inspect the input upstream.

## Stream cancellation: the context `signal`

The context `signal` is separate from `stopReplacingSignal`. It aborts when the stream is cancelled or destroyed before it ends, and, with `LookaheadTransformEngine`, when `abandonPendingSignal` abandons the replacement before its output has begun.

The engine cancels a `ReadableStream` it has been given, such as a `fetch` body, whether or not the signal is passed. Pass the signal on as well:

- to `fetch`, so a request whose response hasn't arrived yet stops straight away
- to a source the engine can't cancel itself, such as a Node `Readable` through `addAbortSignal`, or a generator waiting on other work, which the engine could otherwise close only at its next chunk

As above, a replacement that fails because of the abort doesn't error the stream.

### After the input has ended

`ReplaceContentTransform` cancels the engine whenever the stream is destroyed before it ends. A WHATWG stream whose input has ended is different: a cancel of its output waits for `flush()` to finish, and the transformer isn't told of it, since by design a transformer's [`flush` and `cancel` are never both called](https://github.com/whatwg/streams/pull/1283) ([spec](https://streams.spec.whatwg.org/#transform-stream-default-source-cancel)).

`ReplaceContentTransformer` and `ReplaceContentTextTransformer` cancel the engine at the next piece the cancelled stream refuses, and the signal aborts then. An engine of your own that has no `cancel()`, or whose `cancel()` throws, has that `enqueue` throw instead. A replacement that stalls before its next piece, such as a stalled `fetch`, holds up the cancel, its `signal` doesn't abort, and with `LookaheadTransformEngine` it keeps its concurrency slot. Give it a signal that does abort: `AbortSignal.any([signal, request.signal])` where your server aborts a `request.signal` when the client disconnects, or `AbortSignal.timeout()`.

Bun passes the cancel on from 1.4.0, the minimum this package supports.
