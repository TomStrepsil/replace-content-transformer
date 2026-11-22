# Migrating from 3.x to 4.0

1. Run the [`rename-exports`](#codemod-rename-exports) codemod, which renames every 3.x export that 4.0 exports under another name.
2. Run the three [reports](#reports), which list code that needs a rewrite and edit nothing.
3. Read the [breaking changes](#breaking-changes) below that apply to you. Most need nothing for a consumer that builds an engine and an adapter from this package and passes them a replacement function, beyond the codemod.

Every transform here is idempotent, so running one again over code it has already migrated changes nothing.

## Codemod: `rename-exports`

Renames what `replace-content-transformer`, `/web` and `/node` exported in 3.0.2 and 4.0 exports under another name:

| 3.0.2 | 4.0 |
| --- | --- |
| `SyncReplacementTransformEngine`, `AsyncSerialReplacementTransformEngine` | `SerialTransformEngine` |
| `SyncReplacementTransformEngineOptions`, `AsyncSerialReplacementTransformEngineOptions` | `SerialTransformEngineOptions` |
| `SyncReplacementFn<T>` | `SerialReplacementFn<T, string \| Iterable<string>>` |
| `AsyncSerialReplacementFn<T>` | `SerialReplacementFn<T>` |
| `SyncTransformEngine`, `AsyncTransformEngine` | `TransformEngine` |
| `AsyncLookaheadTransformEngine` | `LookaheadTransformEngine` |
| `AsyncLookaheadTransformEngineOptions` | `LookaheadTransformEngineOptions` |
| `ReplacementFn` | `LookaheadReplacementFn` |
| `ReplaceContentTransform`, `AsyncReplaceContentTransform` (`/node`) | `ReplaceContentTransform` |
| `ReplaceContentTransformer`, `AsyncReplaceContentTransformer` (`/web`) | `ReplaceContentTextTransformer` |

Before:

```ts
import {
  SyncReplacementTransformEngine,
  AsyncSerialReplacementTransformEngine,
  type SyncReplacementFn
} from "replace-content-transformer";
import {
  ReplaceContentTransformer,
  AsyncReplaceContentTransformer
} from "replace-content-transformer/web";

const upperCase: SyncReplacementFn<string> = (match) => match.toUpperCase();
const engine: SyncReplacementTransformEngine<unknown> =
  new SyncReplacementTransformEngine({ searchStrategy, replacement: upperCase });
```

After:

```ts
import {
  SerialTransformEngine,
  type SerialReplacementFn
} from "replace-content-transformer";
import { ReplaceContentTextTransformer } from "replace-content-transformer/web";

const upperCase: SerialReplacementFn<string, string | Iterable<string>> = (match) => match.toUpperCase();
const engine: SerialTransformEngine<unknown, string, string | SerialReplacementFn<string, string | Iterable<string>>> =
  new SerialTransformEngine({ searchStrategy, replacement: upperCase });
```

**Unix/macOS**

```bash
curl -fsSL -o rct-codemod.js https://raw.githubusercontent.com/TomStrepsil/replace-content-transformer/v4.0.0/codemods/transforms/v3-v4/rename-exports.js

# Dry run
npx jscodeshift -t rct-codemod.js --parser=tsx --extensions=js,jsx,ts,tsx,mjs,cjs --dry --print ./src

# Apply
npx jscodeshift -t rct-codemod.js --parser=tsx --extensions=js,jsx,ts,tsx,mjs,cjs ./src

rm rct-codemod.js
```

**Windows (PowerShell)**

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/TomStrepsil/replace-content-transformer/v4.0.0/codemods/transforms/v3-v4/rename-exports.js" -OutFile rct-codemod.js

# Dry run
npx jscodeshift -t rct-codemod.js --parser=tsx --extensions=js,jsx,ts,tsx,mjs,cjs --dry --print ./src

# Apply
npx jscodeshift -t rct-codemod.js --parser=tsx --extensions=js,jsx,ts,tsx,mjs,cjs ./src

del rct-codemod.js
```

From a clone of this repository, `npm run v3-v4:rename-exports -w codemods -- path/to/src`, with the path relative to `codemods/`, does the same.

### Notes

- **Return types.** `SyncReplacementFn<T>` becomes `SerialReplacementFn` with its return type given. The default return type also allows a `Promise`, so a bare `SerialReplacementFn<T>` would make the engine's `write()` and `end()` return `void | Promise<void>` where they returned `void`. For the same reason, `SyncReplacementTransformEngine<…>` and `SyncReplacementTransformEngineOptions<…>` with type arguments, in a type, a `new`, a class's `extends` or `implements`, or an interface's `extends`, gain a third one. A `new SyncReplacementTransformEngine({ … })` without type arguments infers it from the replacement, and is only renamed. Where the file has no `import` from this package to add `SerialReplacementFn` to, such as when it destructures `require()`, the third type argument is reported for you to add instead.
- **`AsyncSerialReplacementFn<T>`** becomes `SerialReplacementFn<T>`, whose default return type is wider: it also allows bytes and a synchronous iterable. A function typed with it type-checks as before.
- **Async serial engine calls.** Where a variable is declared or assigned as a `new AsyncSerialReplacementTransformEngine(…)`, a `write()` or `end()` call on it whose result is used is reported, such as `engine.write(chunk).then(…)`: see [Driving an engine directly](#driving-an-engine-directly). A call that's awaited, voided, a statement of its own, passed to `Promise.resolve()` or `Promise.all()`, or returned from an async function isn't. Nor is one on an engine held elsewhere, such as in a class field, or passed in as an argument.
- **Regex match types.** A `RegExpExecArray` type in a file that uses a regex strategy is reported and left alone: see [Regex matches are a `StreamRegexMatch`](#regex-matches-are-a-streamregexmatch).
- **Web adapters.** Both 3.x web adapters take and emit strings, so both become `ReplaceContentTextTransformer`. In 4.0, `ReplaceContentTransformer` is the byte adapter, and a string chunk errors it. To move a pipeline to the byte adapter, see the [text stream pipeline report](#report-textdecoderstream-and-textencoderstream-pipelines).
- **Run it on 3.x code.** In a file that already imports a name new in 4.0, such as `SerialTransformEngine`, `ReplaceContentTransformer` is taken to be the 4.0 byte adapter and left alone. A file whose only import from this package is a `ReplaceContentTransformer` you moved to bytes by hand would be renamed back to the string adapter.
- **Merging pairs.** When a file imports both names of a pair, such as a sync and an async adapter, they become one specifier, also across separate `import` declarations from the same entry point. A type-only and a value import of a pair become a value import.
- **Local names.** Aliases are kept: `import { AsyncLookaheadTransformEngine as Engine }` becomes `import { LookaheadTransformEngine as Engine }`, and `Engine` is unchanged. Where the 4.0 name is already in use in the file, other than as that name imported from the same entry point, the old name stays as an alias.
- **Only this package's names.** A name is renamed only where it's imported from the entry point that exported it in 3.x. `ReplacementFn` from another package, or declared in the file, is left alone. Named, aliased, type-only and namespace imports, `require()` destructuring, `require()`d namespaces and TypeScript `import("replace-content-transformer").Name` types are covered.
- **Not covered**, neither renamed nor reported: a dynamic `import()`; `import(…)` and other types in JSDoc comments; `import x = require(…)`; a default import; and `declare module "replace-content-transformer"` augmentation. In TypeScript, what's left shows up as an unknown export.
- **Re-exports.** `export { AsyncLookaheadTransformEngine } from "replace-content-transformer"` becomes `export { LookaheadTransformEngine as AsyncLookaheadTransformEngine } from …`, keeping your module's public name, and is reported, so you can decide whether your own consumers should see the 4.0 name. A local `export { AsyncLookaheadTransformEngine }` of a renamed import becomes `export { LookaheadTransformEngine as AsyncLookaheadTransformEngine }` in the same way, and a shorthand property `{ AsyncLookaheadTransformEngine }` becomes `{ AsyncLookaheadTransformEngine: LookaheadTransformEngine }`. An `export * from …` or `export * as name from …` of this package is reported too, since your consumers then see the 4.0 names in place of the 3.x ones. It's reported again on each run.

## Reports

These find and explain, and leave every file untouched. Run them after `rename-exports`, with `--dry`, in the same way. For example, for the search strategy report:

**Unix/macOS**

```bash
curl -fsSL -o rct-report.js https://raw.githubusercontent.com/TomStrepsil/replace-content-transformer/v4.0.0/codemods/transforms/v3-v4/report-search-strategies.js
npx jscodeshift -t rct-report.js --parser=tsx --extensions=js,jsx,ts,tsx,mjs,cjs --dry ./src
rm rct-report.js
```

**Windows (PowerShell)**

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/TomStrepsil/replace-content-transformer/v4.0.0/codemods/transforms/v3-v4/report-search-strategies.js" -OutFile rct-report.js
npx jscodeshift -t rct-report.js --parser=tsx --extensions=js,jsx,ts,tsx,mjs,cjs --dry ./src
del rct-report.js
```

Each finding is printed on a line starting ` REP`, followed by the file and the line. From a clone, `npm run v3-v4:report-search-strategies -w codemods -- path/to/src`, and likewise `v3-v4:report-replacement-contexts` and `v3-v4:report-text-stream-pipelines`.

### Report: custom search strategies

`report-search-strategies.js` lists each strategy whose `processChunk` is still a 3.x generator, and what each `yield` in it becomes (see [Custom search strategies](#custom-search-strategies) below):

```
 REP src/token-strategy.ts line 1: TokenStrategy is a search strategy, whose processChunk reports to a MatchSink in 4.0
    processChunk(haystack: string, state: State) becomes processChunk(haystack: string, state: State, sink: MatchSink): undefined, and is no longer a generator
    line 11: `yield { isMatch: true, content: word, streamIndices: [start, end] }` becomes `if (!sink.reportMatch(word, [start, end])) return;`. Leave the state past the match before returning: the engine calls processChunk("", state, sink) to carry on from it
    line 12: `yield { isMatch: false, content: word }` becomes `sink.reportText(word)`
    save the state in a finally block, so it stays intact when a sink call throws or stops the search, as the built-in strategies do
```

A class or object counts as a strategy when it has `processChunk`, `createState` and `matchToString`, implements `SearchStrategy`, or extends one of this package's strategies, imported by name or through a namespace. It also lists code outside a strategy that reads `processChunk(chunk, state)`'s results itself, such as a custom engine.

A `processChunk` that refers to a function, such as `{ createState, processChunk, matchToString }`, is followed to a function or variable declared in the same file. One it can't follow, such as an imported function, is reported without the detail, on each run, for you to check.

It doesn't find a class that inherits `createState` or `matchToString` from a base class of your own without saying it implements `SearchStrategy`, and it doesn't follow a `yield*` into a generator helper of your own, which needs the sink passed on too.

### Report: code that builds a `ReplacementContext`

`report-replacement-contexts.js` lists each object literal with a context's `matchIndex` and `streamIndices` but no `signal`, such as in a custom engine or in a test that calls a replacement function directly (see [The replacement context's `signal`](#the-replacement-contexts-signal)):

```
 REP src/engine.ts line 42: `{ matchIndex: this.matchIndex++, streamIndices }` builds a ReplacementContext without the signal 4.0 requires. Pass one that aborts when the replacement's output is no longer wanted, such as an engine's own AbortController's signal, or `new AbortController().signal` in a test
```

A literal that spreads another object in, as in `{ ...context, matchIndex }`, is skipped, since the spread may carry the signal.

### Report: `TextDecoderStream` and `TextEncoderStream` pipelines

`report-text-stream-pipelines.js` lists each web adapter piped between a `TextDecoderStream` and a `TextEncoderStream`, which the byte adapter can replace (see [Bytes or text on the web](#bytes-or-text-on-the-web)):

```
 REP src/proxy.ts line 6: the string adapter sits between a TextDecoderStream and a TextEncoderStream. The byte adapter, ReplaceContentTransformer, can replace all three, since it takes and emits UTF-8 bytes. Unlike TextDecoderStream, it keeps a byte order mark at the start of the input in its output, without searching it
```

A `TextDecoderStream` with `ignoreBOM: true` keeps the mark too, so its report leaves that out. A `TextDecoderStream` for an encoding other than UTF-8, or one that may be `fatal`, is left alone, since the byte adapter reads only UTF-8 and writes U+FFFD for malformed input. It also lists the 4.0 byte adapter fed by a `TextDecoderStream`, whose strings error it. It follows a `pipeThrough()` chain, optional calls included, and a `TransformStream` or adapter held in a variable. It looks through `!` and `as` in the chain. It doesn't follow a decoder or encoder held in a variable, a stream passed between functions, or an adapter destructured from `require()`.

## Breaking changes

### Custom search strategies

A strategy reports each result to a `MatchSink`, passed to `processChunk` as a third argument, instead of yielding `MatchResult`s. `processChunk` returns `undefined`, so a strategy still written as a generator is a type error. `flush` is unchanged: it returns the held text without searching it. `settle(state, sink)` is new and optional: the engine calls it in place of `flush` at the end of the stream, so a strategy that deferred a decision at the last chunk boundary can still report a match. `SearchStrategy` and `MatchSink` are now exported from the package root, so a strategy can be typed against them. See [Search Strategies](../../../README.md#-search-strategies).

`reportMatch` returns `false` when the engine wants the search to stop there, for instance while it awaits that match's replacement. The strategy returns at once, with everything after the match left in the state. The engine then carries on by calling `processChunk("", state, sink)`, or calls `flush`. The built-in strategies save the state in a `finally` block, which also keeps it intact when a sink call throws. See [`LoopedIndexOfAnchoredSearchStrategy`](../../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts) for one.

3.x:

```ts
class WordStrategy {
  constructor(private readonly word: string) {}

  createState() {
    return { held: "", offset: 0 };
  }

  *processChunk(haystack: string, state: { held: string; offset: number }) {
    const text = state.held + haystack;
    const start = state.offset - state.held.length;
    const lastSpace = text.lastIndexOf(" ");
    state.held = text.slice(lastSpace + 1);
    state.offset += haystack.length;
    let position = 0;
    for (const piece of text.slice(0, lastSpace + 1).match(/[^ ]* /g) ?? []) {
      if (piece.trimEnd() === this.word) {
        yield { isMatch: true, content: piece, streamIndices: [start + position, start + position + piece.length] };
      } else {
        yield { isMatch: false, content: piece };
      }
      position += piece.length;
    }
  }

  flush(state: { held: string; offset: number }) {
    const { held } = state;
    state.held = "";
    return held;
  }

  matchToString(match: string) {
    return match;
  }
}
```

4.0:

```ts
import type { MatchSink, SearchStrategy } from "replace-content-transformer";

type WordState = { held: string; offset: number };

class WordStrategy implements SearchStrategy<WordState> {
  constructor(private readonly word: string) {}

  createState() {
    return { held: "", offset: 0 };
  }

  processChunk(haystack: string, state: WordState, sink: MatchSink): undefined {
    const text = state.held + haystack;
    const start = state.offset - state.held.length;
    const lastSpace = text.lastIndexOf(" ");
    let position = 0;
    try {
      for (const piece of text.slice(0, lastSpace + 1).match(/[^ ]* /g) ?? []) {
        const end = position + piece.length;
        if (piece.trimEnd() !== this.word) {
          sink.reportText(piece);
        } else if (!sink.reportMatch(piece, [start + position, start + end])) {
          position = end;
          return;
        }
        position = end;
      }
    } finally {
      state.held = text.slice(position);
      state.offset += haystack.length;
    }
  }

  flush(state: WordState) {
    const { held } = state;
    state.held = "";
    return held;
  }

  matchToString(match: string) {
    return match;
  }
}
```

The [search strategy report](#report-custom-search-strategies) lists what to change.

### Custom engines and adapters

Once renamed, an engine implementing `SyncTransformEngine` or `AsyncTransformEngine` compiles against `TransformEngine`, apart from the [context's `signal`](#the-replacement-contexts-signal):

```ts
interface TransformEngine {
  start(sink: EngineSink): void;
  write(chunk: string): void | Promise<void>;
  end(): void | Promise<void>;
  cancel?(): void;
}
```

- An asynchronous engine may now return `undefined` from a call that finished synchronously. The adapters then carry on without waiting.
- An adapter of your own that drove a `SyncTransformEngine` must now handle a `Promise` from `write()` and `end()`.
- An engine that reads a strategy's results itself must pass it a `MatchSink`: see [Custom search strategies](#custom-search-strategies). The [search strategy report](#report-custom-search-strategies) lists these call sites too.
- `EngineSink.enqueue` still takes only strings, so a custom sink needs no change. One that sets `acceptsBytes: true` also receives `Uint8Array`s, typed as `ByteEngineSink`.
- Given a web adapter's sink, an engine should implement `cancel()`. Once the output can no longer take a chunk, the adapter calls it and drops the chunk, where the sink used to throw. An engine without `cancel()`, or whose `cancel()` throws, still sees the throw. See [Stream cancellation](../../../README.md#stream-cancellation).

### Driving an engine directly

Code that calls an engine's `write()` and `end()` itself, rather than through an adapter, sees the other side of the change above. `AsyncSerialReplacementTransformEngine`'s calls always returned a `Promise`. `SerialTransformEngine`'s return `undefined` when they finish synchronously, which they do unless a replacement in them is asynchronous, so `engine.write(chunk).then(…)` throws a `TypeError`. `await` the call instead, which works either way, or wrap it in `Promise.resolve()`. In TypeScript, the return type `void | Promise<void>` shows where. The codemod reports such calls on a variable holding an async serial engine.

### `maxBufferLength`

Every strategy now limits what it holds back awaiting a decision to `maxBufferLength`, 65,536 UTF-16 code units by default. A match still incomplete that far from its start no longer matches: its text up to there passes through, and the search restarts after it. `maxBufferLength: Infinity` restores 3.x behaviour, along with the unbounded memory the limit guards against.

To choose a limit, take the longest match you expect, and allow for the input a regex such as `/\S+/` could still be extending. Set `onGuardExceeded` to find out when the limit is hit, for instance to log it, or to stop replacing. See [Buffer limit](../../../README.md#buffer-limit) and [What `onGuardExceeded` can do](../../../README.md#what-onguardexceeded-can-do).

```ts
new RegexSearchStrategy(/<!--#include .*?-->/s, {
  maxBufferLength: 16 * 1024,
  onGuardExceeded: () => console.warn("an include ran on past 16 KiB")
});
```

### `regex-partial-match` is a peer dependency

npm 7+, pnpm 8+, Bun and Deno install it automatically. With Yarn, Classic or Berry, add it yourself:

```bash
yarn add regex-partial-match
```

See [Installation](../../../README.md#-installation).

### Regex matches no longer depend on chunk boundaries

`RegexSearchStrategy` finds the same matches however the input is split, so `/[A-Z]+/` over `"MAT"` + `"CH"` matches `MATCH`, not `MAT` and `CH`. A match that could still grow is held until the next chunk or the end of the stream, so a test that asserts which chunk some output arrives in may change. Assert the joined output instead. The exceptions are a chunk that ends more than 64 characters into the text a backreference repeats (see [Backreferences](../../../src/search-strategies/regex/README.md#️-backreferences)), and one that ends inside a `v`-flag string of several code points, such as an emoji flag matched by `\p{RGI_Emoji}` (see [Strings of several code points](../../../src/search-strategies/regex/README.md#️-strings-of-several-code-points-v-flag)).

### Regex matches are a `StreamRegexMatch`

`RegexSearchStrategy`, `LeanRegexSearchStrategy` and `searchStrategyFactory` given a `RegExp` report each match as a `StreamRegexMatch`, exported from the package root, rather than a `RegExpExecArray`. Capture groups (`match[1]`, `match.groups`) are unchanged, but:

- `index`, and `indices` with the `d` flag, count from the start of the stream, so `match.index` is the same as `streamIndices[0]`. In 3.x they counted from the start of the text being scanned, which depended on how the input was split.
- `input` is `undefined`. In 3.x it was that scanned text, not the stream. Use `match[0]` and the capture groups instead.

A replacement typed `(match: RegExpExecArray) => …` no longer compiles. Type it `StreamRegexMatch`, or let the engine infer it:

```ts
import { RegexSearchStrategy, SerialTransformEngine, type StreamRegexMatch } from "replace-content-transformer";

new SerialTransformEngine({
  searchStrategy: new RegexSearchStrategy(/\{\{(\w+)\}\}/),
  replacement: (match: StreamRegexMatch) => values[match[1]]
});
```

`rename-exports` reports each `RegExpExecArray` type in a file that uses a regex strategy, and leaves it for you, since the file may use it for regexes of its own.

### `LookaheadTransformEngine`'s `highWaterMark`

It must be a whole number of at least 1, or `Infinity`, or the constructor throws a `RangeError`. In 3.x, `NaN` turned backpressure off, a fraction was accepted, and `null` selected the default. Pass `Infinity` for no backpressure, or leave the option out for the default.

### When a serial replacement is called

Unlike `AsyncSerialReplacementTransformEngine`, `SerialTransformEngine` calls a replacement before the text in front of its match reaches the sink. That matters only for a replacement with side effects, and a consumer that stops the stream on seeing output, which in practice means a Node `data` listener or `pipe()` destination. With a `stopReplacingSignal`, the Node adapter receives output as it is produced, so a consumer that aborts the signal on seeing some output prevents every replacement after it:

```ts
const stopOnOutput = new AbortController();
const transform = new ReplaceContentTransform(
  new SerialTransformEngine({
    searchStrategy,
    replacement,
    stopReplacingSignal: stopOnOutput.signal
  })
);
transform.on("data", (chunk: Buffer) => {
  if (seenEnough(chunk)) stopOnOutput.abort();
});
```

See [Stopping on output](../../../README.md#stopping-on-output) for when this holds.

### Errors from a synchronous replacement on Node

A synchronous replacement that throws now destroys `ReplaceContentTransform` with the error, as one did with `AsyncReplaceContentTransform`. In 3.x, `ReplaceContentTransform` let the error escape `write()`. Listen for `error`, or use `pipeline()`, rather than catching around `write()`.

### Bytes or text on the web

`ReplaceContentTransformer` now takes and emits UTF-8 `Uint8Array`, and `ReplaceContentTextTransformer`, which the codemod switches 3.x code to, takes and emits strings.

- Keep `ReplaceContentTextTransformer` where the source is already strings, such as an LLM token stream, where the input isn't UTF-8 and needs a `TextDecoderStream` for its encoding, or where the output must stay strings.
- Move to `ReplaceContentTransformer` where a byte stream such as `Response.body` was decoded only to be replaced and encoded again. Drop the `TextDecoderStream` and `TextEncoderStream` around it. It keeps a byte order mark at the start of the input in its output, without searching it, where `TextDecoderStream` dropped it.

```ts
// 3.x, after the codemod
const replaced = response.body!
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine)))
  .pipeThrough(new TextEncoderStream());

// 4.0, bytes throughout
const replaced = response.body!.pipeThrough(new TransformStream(new ReplaceContentTransformer(engine)));
```

Replacements can now return bytes too, a `Uint8Array`, or an iterable or async iterable of them, to either adapter. So the `res.body!.pipeThrough(new TextDecoderStream())` that 3.x's recipes returned from a replacement can go:

```ts
replacement: async (match, { signal }) => {
  const response = await fetch(urlFor(match), { signal });
  return response.ok ? response.body! : match;
}
```

The [text stream pipeline report](#report-textdecoderstream-and-textencoderstream-pipelines) lists the pipelines to look at. See [WHATWG Transformer](../../../README.md#whatwg-transformer) and [Async Iterable Replacement](../../../README.md#async-iterable-replacement).

### Byte order mark on Node

`ReplaceContentTransform` no longer searches a byte order mark at the start of its input. It's kept at the start of the output, and `streamIndices` count from the text after it, as with a `TextDecoder`. This matters only for a needle that matched the mark, or code that relied on the offset it added. See [Node Transform](../../../README.md#node-transform).

### Node output is always UTF-8

`ReplaceContentTransform` used to encode its text output with the stream's `defaultEncoding`. It now always encodes UTF-8. A consumer that set a non-UTF-8 `defaultEncoding`, such as `"latin1"`, and read the output back with the same readable `encoding`, now sees the UTF-8 bytes decoded in that encoding instead. Read it as UTF-8, or leave `defaultEncoding` at its default.

### Bun 1.4.0

Bun 1.4.0 is the minimum supported version, up from 1.0. See [Compatibility](../../../README.md#-compatibility).

### Stopping with `stopReplacingSignal`

Once `stopReplacingSignal` has aborted, a replacement that fails with its `reason` or an `AbortError`, or an error with either in its `cause` chain, no longer errors the stream. It ends there, and its match is emitted verbatim if it had produced nothing. A `fetch` given the signal fails that way once it aborts, so the `try`/`catch` around it in 3.x's [Limit replacements](../../../README.md#limit-replacements) recipe can go, unless you want something other than the match in its place:

```ts
// 3.x
replacement: async (match) => {
  try {
    const response = await fetch(urlFor(match), { signal: abortController.signal });
    if (response.ok) return response.body!.pipeThrough(new TextDecoderStream());
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return (async function* () {
        yield "<!-- cancelled -->";
      })();
    }
    throw error;
  }
}

// 4.0
replacement: async (match, { signal }) => {
  const response = await fetch(urlFor(match), {
    signal: AbortSignal.any([signal, abortController.signal])
  });
  return response.ok ? response.body! : match;
}
```

A consumer that relied on that error to detect the stop has to check `abortController.signal.aborted` instead. Without a `stopReplacingSignal`, or before it aborts, an `AbortError` still errors the stream.

### The replacement context's `signal`

The replacement context has a required `signal`, owned by the engine, which aborts when the engine is cancelled, or, with `LookaheadTransformEngine`, when `abandonPendingSignal` abandons the replacement. `ReplaceContentTransform` cancels the engine whenever its stream is destroyed before it ends. A web adapter does so when its output is cancelled before its input has ended. Once the input has ended, a cancel waits for the replacements still being read, and the signal aborts only at the next piece the cancelled stream refuses, so it doesn't abort for a replacement that has stalled (see the note under [Stream cancellation](../../../README.md#stream-cancellation)).

So pass the context's `signal` to `fetch`, but keep a signal of your own for a request that might stall after the input ends, and combine the two with `AbortSignal.any()`: a server's `request.signal`, which aborts when the client disconnects, or an `AbortSignal.timeout()`. Neither is a signal the engine knows, so a replacement that fails from either errors the stream. A timeout fails with a `TimeoutError`, so catch it where the match should pass through instead. A timeout while the body is being read still errors the stream:

```ts
replacement: async (match, { signal }) => {
  try {
    const response = await fetch(urlFor(match), {
      signal: AbortSignal.any([signal, request.signal, AbortSignal.timeout(10_000)])
    });
    return response.ok ? response.body! : match;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") return match;
    throw error;
  }
}
```

An engine of your own that builds a `ReplacementContext`, or a test that calls a replacement function directly, must now include a `signal`:

```ts
replacement(match, { matchIndex: 0, streamIndices: [0, 5], signal: new AbortController().signal });
```

The [replacement context report](#report-code-that-builds-a-replacementcontext) lists these. See [Stream cancellation](../../../README.md#stream-cancellation).
