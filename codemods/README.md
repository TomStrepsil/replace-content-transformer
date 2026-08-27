# Codemods

This directory contains migration codemods for breaking API changes.

## Available Codemods

### v3 -> v4: [migration report](./transforms/v3-v4/README.md)

`SearchStrategy.flush(state)` returns a generator of `MatchResult`s rather than a `string`.
These two **report** what to change and leave every file untouched, so run them in either order:

1. `report:flush-implementations` — every `flush` implementation, with the signature to write and what each `return` becomes
2. `report:flush-call-sites` — every call site, with the drain loop written out for the names in use

### v1 -> v2: [two-step migration](./transforms/v1-v2/README.md)

Run in order:

1. `replacement-callback-positional-to-context` — migrates callback signatures from positional args to a context object
2. `processor-to-engine` — renames processor classes to engines, moves `stopReplacingSignal`, strips dropped type parameters
