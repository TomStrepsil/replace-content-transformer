# `replacement-callback-positional-to-context`

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

## Usage

Dry run:

```bash
npm run codemod:replacement-callback-context -- --dry --print src
```

Apply changes:

```bash
npm run codemod:replacement-callback-context -- src
```

Narrow by extensions if needed:

```bash
npm run codemod:replacement-callback-context -- --extensions=ts,tsx "src/**/*.ts"
```

## Notes

- The transform only updates inline function/arrow callbacks under a `replacement` property.
- Existing context-object signatures are left unchanged.
- If the third positional arg is destructured inline (for example, `[startIndex, endIndex]`), the transform intentionally skips that callback for manual migration.
- Non-standard callback signatures are skipped for safety and should be migrated manually.