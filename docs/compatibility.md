# Compatibility

The package uses the [WHATWG Streams API](https://streams.spec.whatwg.org/), and is tested on Node.js, Bun and Deno in CI.

| Runtime      | Minimum                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| Node.js      | 22.0.0 (see [Encoding the output on older Node](./adapters.md#encoding-the-output-on-older-node)) |
| Bun          | 1.4.0                                                                   |
| Deno         | 1.38                                                                    |
| Chrome, Edge | 85                                                                      |
| Firefox      | 102                                                                     |
| Safari       | 15                                                                      |

Edge workers: Cloudflare Workers, Vercel Edge Functions, Akamai EdgeWorkers and Fastly Compute.

`LookaheadTransformEngine` also needs [`AbortSignal.any()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static): Chrome and Edge 116+, Firefox 124+, Safari 17.4+ and Deno 1.39+.

`ReplaceContentStream` and `ReplaceContentTextStream` cancel the engine as soon as their writable side is aborted only where [`WritableStreamDefaultController.signal`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultController/signal) exists: Chrome and Edge 98+, Firefox 100+ and Safari 16.4+. Elsewhere an abort reaches the engine only once the chunk being written has finished, as one through `pipeTo()` does, so cancel the readable side too.

Some browsers fail an aborted `fetch` or its body with an `AbortError` of their own rather than the signal's reason, as do those without [`AbortSignal.reason`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/reason) (Chrome and Edge before 98, Safari before 15.4). Since an `AbortError` [ends a replacement cleanly](./cancellation.md#stopping-requests-in-flight) too, these behave the same. Where [`throwIfAborted()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted) is missing (Chrome and Edge before 100, Safari before 15.4), a replacement checking the signal itself can throw `new DOMException("Aborted", "AbortError")`.

A regex search strategy also needs whatever its pattern's own syntax needs, such as the `v` flag. See `regex-partial-match`'s [Compatibility](https://github.com/TomStrepsil/regex-partial-match/blob/main/docs/compatibility.md).
