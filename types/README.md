# TypeScript lib overrides

This directory contains a local replacement for a TypeScript built-in lib file, working around an incorrect type in the standard library.

TypeScript 4.5+ supports this via its `@typescript/lib-*` substitution mechanism: when `libReplacement` is enabled in `tsconfig.json`, TypeScript resolves each lib file as a module (`@typescript/<lib-name>/<subpath>`) using Node10 module resolution before falling back to its own built-in. Packages here are wired in as `file:` devDependencies in `package.json`.

## 🔢 `lib-es2022` — named capture group indices

**Fixes:** `RegExpIndicesArray.groups`

**Upstream issue:** [microsoft/TypeScript#63281](https://github.com/microsoft/TypeScript/issues/63281)

The built-in lib declares named capture group indices (from the `d` flag) as:

```ts
groups?: { [key: string]: [number, number] }
```

But an optional group that did not participate returns `undefined` for its indices. The correct type is:

```ts
groups?: { [key: string]: [number, number] | undefined }
```

This mirrors the fix already applied to the outer `RegExpIndicesArray` array elements (`Array<[number, number] | undefined>`), which the upstream library corrected in a prior release but overlooked for named group indices.
