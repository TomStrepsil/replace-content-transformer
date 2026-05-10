# Codemods

This directory contains migration codemods for breaking API changes.

## Available Codemods

### v1 -> v2: [two-step migration](./transforms/v1-v2/README.md)

Run in order:

1. `replacement-callback-positional-to-context` — migrates callback signatures from positional args to a context object
2. `processor-to-engine` — renames processor classes to engines, moves `stopReplacingSignal`, strips dropped type parameters
