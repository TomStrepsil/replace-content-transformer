# Codemods

This directory contains migration codemods for breaking API changes.

From a clone of this repository, each transform runs as `npm run <version>:<transform> -w codemods -- path/to/src`, with the path relative to `codemods/`. For example, `npm run v3-v4:rename-exports -w codemods -- path/to/src`.

## Available Codemods

### v1 -> v2: [two-step migration](./transforms/v1-v2/README.md)

Run in order:

1. `replacement-callback-positional-to-context` — migrates callback signatures from positional args to a context object
2. `processor-to-engine` — renames processor classes to engines, moves `stopReplacingSignal`, strips dropped type parameters

### v3 -> v4: [codemod, reports and guide](./transforms/v3-v4/README.md)

1. `rename-exports` — renames the 3.x engines, adapters and types to their 4.0 names
2. `report-search-strategies`, `report-replacement-contexts` and `report-text-stream-pipelines` — list code that needs a rewrite, editing nothing
