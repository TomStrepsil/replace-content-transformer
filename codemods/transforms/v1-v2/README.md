# v1 → v2 migration codemods

Run these in order. Each transform is idempotent, so re-running a step that has already been applied is safe.

## Step 1 — `replacement-callback-positional-to-context`

Transforms replacement callback signatures from positional arguments to a context-object form.

Before:

```ts
replacement: (match, matchIndex) => `#${matchIndex}: ${match}`
replacement: (match, matchIndex, streamIndices) => `${streamIndices[0]}-${streamIndices[1]}`
```

After:

```ts
replacement: (match, { matchIndex }) => `#${matchIndex}: ${match}`
replacement: (match, { matchIndex, streamIndices }) => `${streamIndices[0]}-${streamIndices[1]}`
```

Dry run:

```bash
npm run codemod:replacement-callback-context -- --dry --print src
```

Apply changes:

```bash
npm run codemod:replacement-callback-context -- src
```

### Notes

- Only updates inline function/arrow callbacks under a `replacement` property.
- Existing context-object signatures are left unchanged.
- If the third positional arg is destructured inline (for example, `[startIndex, endIndex]`), the transform intentionally skips that callback for manual migration.
- Non-standard callback signatures are skipped for safety and should be migrated manually.

---

## Step 2 — `processor-to-engine`

Renames the deprecated processor classes to their engine equivalents, moves `stopReplacingSignal` from the adapter constructor into the engine options when the engine is inlined, and strips the now-dropped type parameter from adapter constructors.

| Old | New |
|---|---|
| `StaticReplacementProcessor` | `SyncReplacementTransformEngine` |
| `FunctionReplacementProcessor` | `SyncReplacementTransformEngine` |
| `IterableFunctionReplacementProcessor` | `SyncReplacementTransformEngine` |
| `AsyncFunctionReplacementProcessor` | `AsyncSerialReplacementTransformEngine` |
| `AsyncIterableFunctionReplacementProcessor` | `AsyncSerialReplacementTransformEngine` |

Before:

```ts
import { FunctionReplacementProcessor } from "replace-content-transformer";

const engine = new FunctionReplacementProcessor({
  searchStrategy,
  replacement: (match, { matchIndex }) => `${matchIndex}: ${match}`,
});

const transformer = new ReplaceContentTransformer<Promise<string>>(engine, abortController.signal);
```

After:

```ts
import { SyncReplacementTransformEngine } from "replace-content-transformer";

const engine = new SyncReplacementTransformEngine({
  searchStrategy,
  replacement: (match, { matchIndex }) => `${matchIndex}: ${match}`,
});

const transformer = new ReplaceContentTransformer(engine);
```

When the engine is constructed inline in the adapter call, `stopReplacingSignal` is moved automatically:

```ts
// Before
const t = new ReplaceContentTransformer(
  new FunctionReplacementProcessor({ searchStrategy, replacement }),
  abortController.signal
);

// After
const t = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({ searchStrategy, replacement, stopReplacingSignal: abortController.signal })
);
```

Dry run:

```bash
npm run codemod:processor-to-engine -- --dry --print src
```

Apply changes:

```bash
npm run codemod:processor-to-engine -- src
```

### Notes

- Aliased imports (`import { FunctionReplacementProcessor as FRP }`) are not renamed; update the alias and its usages manually.
- When `stopReplacingSignal` is held in a variable and passed by reference (not inline), it cannot be moved automatically — TypeScript will surface the remaining mismatch as a type error.
- If you previously used `AsyncFunctionReplacementProcessor` or `AsyncIterableFunctionReplacementProcessor` and want concurrent lookahead semantics, migrate to `AsyncLookaheadTransformEngine` manually; the codemod maps to the conservative `AsyncSerialReplacementTransformEngine` which preserves identical serial behaviour.
