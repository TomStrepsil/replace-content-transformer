# Balanced Pair Search Strategy

A search strategy for matching **balanced delimiter pairs**, including nested occurrences, by keeping each opening delimiter that awaits its closing delimiter on a stack.

## Algorithm Overview

This strategy finds opening/closing delimiter pairs where nesting is meaningful: the match only completes when every opening delimiter inside it has a corresponding closing delimiter. For example:

- `(`, `)` matches `(content)`, `((a) b)`, `(((deep)))`
- `{{`, `}}` matches `{{value}}`, `{{{{nested}}}}`
- `[`, `]` matches `[outer [inner] rest]`

A simple anchor search would match the _first_ closing delimiter after the opening, producing incomplete matches in nested input. `BalancedPairSearchStrategy` pairs each closing delimiter with the most recent opening one still open, and the match only completes when the outermost opening is closed.

### Nesting Detection

```
Opening: "("  Closing: ")"
Input:   "((inner) outer)"

 Position:  0 1 2 3 4 5 6 7 8 9 10 11 12 13 14
 Char:      ( ( i n n e r )   o  u  t  e  r  )
            ↑ ↑           ↑                  ↑
            open  open    close              close

 "(" at 0:   open pairs [0]
 "(" at 1:   open pairs [0, 1]
 ")" at 7:   closes 1 → (1, 8) completes inside 0; open pairs [0]
 ")" at 14:  closes 0, the outermost → yield "((inner) outer)" as a match
```

**Without nesting awareness:**

```
Anchor strategy alone:
  Input:  "((inner) outer)"
  Match:  "((inner)"    ← stops at first ), incomplete!
```

## Implementation Details

Outside a pair, only opening delimiters are searched for. Inside one, the next opening and the next closing delimiter are found, and whichever ends first is taken: an opening is pushed, and a closing pops the most recent opening. Pairs completed inside the outermost opening are kept, in case it is abandoned (see [Buffer Guard](#buffer-guard)), until an enclosing pair completes.

Where an opening and a closing delimiter overlap, the one that ends first is taken, the opening on a tie. With `"**"` and `"*"`, `"**a**"` matches `"**a*"`: the `"*"` at 3 ends before the `"**"` there, and the last `"*"` is text.

Each delimiter's search resumes where its last search left off, and the content not yet reported is held in a `HeldText`, which keeps each chunk as received. A pair held across many chunks costs time linear in its length.

## Buffer Guard

A pair longer than `maxBufferLength` (65,536 code units by default) never matches. Its opening delimiter passes through as text, and the pairs nested inside it are matched as if it were absent:

```typescript
const strategy = new BalancedPairSearchStrategy("{{", "}}", {
  maxBufferLength: 10
});
// "{{ {{a}} {{b}} xx" → "{{ ", match "{{a}}", " ", match "{{b}}", " xx"
// "{{" + 1 MiB with no "}}" → passed through once more than 10 code units are held
```

The rule depends on a pair's length, not on where chunks fall, so results are the same however the input is split. `onGuardExceeded` is called once for each opening delimiter given up on. See [Buffering and the guard](../../../README.md#buffering-and-the-guard).

## State Management

```typescript
type BalancedPairSearchState = {
  /** Content received but not yet reported. */
  held: HeldText;
  /** Stream position at or after which the next opening delimiter may start. */
  openingFrom: number;
  /** Stream position at or after which the next closing delimiter may start. */
  closingFrom: number;
  /**
   * From index `outermost`, in stream order: each opening delimiter awaiting its
   * closing delimiter (`[start, -1]`), and each pair completed inside them.
   */
  pairs: StreamIndices[];
  outermost: number;
};
```

**Flush behaviour:**

If a stream ends while a pair is open (e.g. `((inner)` with no outer `)`), `flush` returns everything held, from the outermost opening delimiter, as raw text.

**Stopping early:**

If an engine stops iterating `processChunk` part-way, e.g. once `stopReplacingSignal` aborts, `flush` returns everything not yet yielded. The state is brought up to date before each result is yielded, so stopping after any result never leaves a pair half-recorded.

## Cross-Chunk Matching

The strategy correctly handles matches that span chunk boundaries at every level:

```
Opening: "("   Closing: ")"
Chunk 1: "((inner)"
Chunk 2: " outer)"

Process Chunk 1:
  - "(" at 0 and 1 open; ")" at 7 closes 1
  - 0 is still open: hold "((inner)"

Process Chunk 2:
  - ")" at 14 closes 0, the outermost
  - Yield "((inner) outer)", streamIndices: [0, 15]
```

## Stream Indices

Matches report `streamIndices` as absolute offsets into the full stream, not relative to the current chunk:

```
Stream:       "prefix ((inner) outer) suffix"
               0      7       15      22

Match yields: { isMatch: true, content: "((inner) outer)", streamIndices: [7, 22] }
```

`streamIndices[0]` is the start of the outermost opening delimiter; `streamIndices[1]` is the end of the outermost closing delimiter (exclusive, following the same convention as [`String.prototype.slice`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice)).

## Performance Characteristics

Each delimiter is searched for with `indexOf`, resuming where its last search ended, and each one found is pushed or popped once, so the cost is linear in stream length however deep the nesting, including when pairs are abandoned.

| Scenario                         | Characteristic                                                      |
| -------------------------------- | ------------------------------------------------------------------- |
| No matches in stream             | One `indexOf` pass for the opening delimiter; only a possible prefix of it is held |
| Flat (non-nested) matches        | One search per delimiter                                            |
| Deeply nested matches            | One stack entry per open delimiter                                  |
| Partial matches at boundaries    | Only holds a tail that could begin the opening delimiter            |

## Usage Examples

### Single-Character Delimiters

```typescript
import { BalancedPairSearchStrategy } from "replace-content-transformer";

const strategy = new BalancedPairSearchStrategy("(", ")");
```

### Multi-Character Delimiters

```typescript
// Matches {{value}}, {{{{doubly nested}}}}, etc.
const strategy = new BalancedPairSearchStrategy("{{", "}}");
```

### With an Engine

```typescript
import {
  BalancedPairSearchStrategy,
  SyncReplacementTransformEngine
} from "replace-content-transformer";
import { ReplaceContentTransformer } from "replace-content-transformer/web";

// Replace every top-level balanced `(...)` expression, including nested ones
const transformer = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({
    searchStrategy: new BalancedPairSearchStrategy("(", ")"),
    replacement: (match: string) => `[${match.slice(1, -1)}]`
  })
);
```

### Detecting Nesting Depth

Since the full matched content is available in the replacement function, nesting depth can be calculated from the match itself:

```typescript
const strategy = new BalancedPairSearchStrategy("(", ")");

const transformer = new ReplaceContentTransformer(
  new SyncReplacementTransformEngine({
    searchStrategy: strategy,
    replacement: (match: string) => {
      const depth = (match.match(/\(/g) ?? []).length;
      return `/* depth ${depth} */${match}`;
    }
  })
);
```
