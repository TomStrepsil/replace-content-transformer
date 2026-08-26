# Codemods

This directory contains migration codemods for breaking API changes.

## Available Codemods

### v3 -> v4: [two-step migration](./transforms/v3-v4/README.md)

`SearchStrategy.flush(state)` returns a generator of `MatchResult`s rather than a `string`.
Run in order:

1. `codemod:flush-implementation` — rewrites `flush` implementations to generators
2. `codemod:flush-call-site` — wraps call sites in a drain loop, preserving current behaviour and flagging the new opportunity

### v1 -> v2: [two-step migration](./transforms/v1-v2/README.md)

Run in order:

1. `replacement-callback-positional-to-context` — migrates callback signatures from positional args to a context object
2. `processor-to-engine` — renames processor classes to engines, moves `stopReplacingSignal`, strips dropped type parameters
