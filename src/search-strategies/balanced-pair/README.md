# Balanced Pair Search Strategy

A search strategy for matching **balanced delimiter pairs** — including nested occurrences — by layering nesting-level tracking on top of the [`StringAnchorSearchStrategy`](../looped-indexOf-anchored/README.md).

## Algorithm Overview

This strategy finds opening/closing delimiter pairs where nesting is meaningful: the match only completes when every opening delimiter inside it has a corresponding closing delimiter. For example:

- `(`, `)` matches `(content)`, `((a) b)`, `(((deep)))`
- `{{`, `}}` matches `{{value}}`, `{{{{nested}}}}`
- `[`, `]` matches `[outer [inner] rest]`

A simple anchor search would match the _first_ closing delimiter after the opening, producing incomplete matches in nested input. `BalancedPairSearchStrategy` extends that underlying search so every inner pair is counted and the match only closes when the depth returns to zero.

### Nesting Detection

```
Opening: "("   Closing: ")"
Input:   "((inner) outer)"

 Position:  0 1 2 3 4 5 6 7 8 9 10 11 12 13 14
 Char:      ( ( i n n e r )   o  u  t  e  r  )
            ↑             ↑                  ↑
       pair opens     first )            outer )
     nestingLevel=1    found              found

 On first ) at position 7:
   Count "(" in "(inner)", after the opening: one opening
   nestingLevel = 1 + 1 − 1 = 1
   Not yet balanced (nestingLevel > 0) — keep looking for more ")"

 On outer ) at position 14:
   Count "(" in " outer)", after the first ): zero openings
   nestingLevel = 1 + 0 − 1 = 0
   Balanced! Report "((inner) outer)" as a match
```

**Without nesting awareness:**

```
Anchor strategy alone:
  Input:  "((inner) outer)"
  Match:  "((inner)"    ← stops at first ), incomplete!
```

## Implementation Details

`BalancedPairSearchStrategy` wraps `LoopedIndexOfAnchoredSearchStrategy` with the anchors `[opening, closing]`, and gives it an `acceptMatch` that accepts a pair only once it balances. That option is keyed by a symbol the package doesn't export, so it is internal to the two strategies:

```typescript
const anchorOptions: AnchorOptions<BalancedPairSearchState> = {
  ...options,
  [acceptMatch]: (state, pairStart, searched) => this.isBalanced(state, pairStart, searched)
};
this.anchorStrategy = new LoopedIndexOfAnchoredSearchStrategy([opening, closing], anchorOptions);
```

The anchor strategy knows nothing of nesting. It calls `acceptMatch` with the stream index of the pair's opening and the text it searched to find this closing. When the callback rejects a pair, it searches for the next closing, still from the pair's opening, and offers the longer pair again. Once one is accepted, it reports the match from the opening to this closing, so its content and `streamIndices` are the whole pair. Searching, holding text across chunks, the guard, and stopping all come from the anchor strategy.

### Incremental Content Tracking

Each offer gives the stretch searched for the closing just found: from the end of the opening, or of the closing before, to the end of this closing. A pair whose opening is at a new stream index starts at a `nestingLevel` of 1, and each offer adds the openings in its stretch, less one for the closing. So each opening is counted once, however many closings come between:

```typescript
if (state.pairStart !== pairStart) {
  state.pairStart = pairStart;
  state.nestingLevel = 1;
}
state.nestingLevel += this.countOpenings(searched) - 1;
return state.nestingLevel === 0;
```

`countOpenings` is a `while`/`indexOf` loop over that stretch.

### Across Chunks

While a pair is open, the anchor strategy holds it from its opening, and `matchConsumedLength` marks the end of the last closing found. The next chunk resumes the search for a closing there, and `nestingLevel` carries over, since the pair's opening is still at the same stream index.

## Buffer limit

The guard options are passed to the anchor strategy, whose match is the whole pair, from its opening. So a pair still unbalanced `maxBufferLength` code units (65,536 by default) after its opening passes through as text up to there, `onGuardExceeded` is called, and the search restarts right after. The next pair offered has a later opening, so its count starts afresh:

```typescript
const strategy = new BalancedPairSearchStrategy("(", ")", { maxBufferLength: 5 });
// "(a(b)(c)d)e" → "(a(b)" as text, then "(c)" as a match, then "d)e" as text
// "( unclosed …" → output resumes once 5 code units from "(" have arrived
```

The decision depends only on the text, so it is the same however the input is split. A limit shorter than the opening and closing together, under which nothing could match, throws a `RangeError`. See [Buffer limit](../../../docs/search-strategies.md#buffer-limit).

## State Management

`BalancedPairSearchState` extends `LoopedIndexOfAnchoredSearchState`:

```typescript
type BalancedPairSearchState = LoopedIndexOfAnchoredSearchState & {
  /** Stream index of the opening delimiter whose pair is being balanced, or -1 */
  pairStart: number;
  /** Number of opening delimiters currently awaiting a closing delimiter */
  nestingLevel: number;
};
```

These fields are internal to the strategy, and hidden from its published types.

**State transitions:**

| Condition                        | `nestingLevel`        | Action                                     |
| -------------------------------- | --------------------- | ------------------------------------------ |
| No match found                   | unchanged (0)         | Pass through as non-match                  |
| Opening found, no inner opens    | `1` − 1 = `0`         | Accept: report as complete match           |
| Opening found, inner opens exist | `> 0`                 | Reject: search for the next closing        |
| Subsequent close balances depth  | decrements toward `0` | Continue, or report when reaching `0`      |
| Pair passes `maxBufferLength`    | restarts at the next pair | Pass through as non-match              |
| Flush mid-match                  | reset to `0`          | Return the anchor strategy's held content  |

**Flush behaviour:** if a stream ends while a pair is open (e.g. `((inner)` with no outer `)`), `flush` returns what the anchor strategy holds, the pair from its opening, and resets `nestingLevel`.

**Stopping early:**

When the engine's sink returns `false` for a pair, e.g. once `stopReplacingSignal` aborts, the anchor strategy stops and leaves everything after it in the state, so `flush` returns it and `processChunk("")` carries on from it. A pair rejected while unbalanced is never reported, so the search can only stop at a whole pair and never leaves one half-recorded.

## Cross-Chunk Matching

The strategy correctly handles matches that span chunk boundaries at every level:

```
Opening: "("   Closing: ")"
Chunk 1: "((inner)"
Chunk 2: " outer)"

Process Chunk 1:
  - Anchor strategy offers "((inner)": counts "(inner)" after the opening
  - nestingLevel: 1 + 1 − 1 = 1 (one "(" inside, one ")" closes)
  - still open: continue scanning for ")"
  - Chunk ends: the anchor strategy holds "((inner)", matchConsumedLength 8

Process Chunk 2:
  - Anchor strategy offers "((inner) outer)", counted from 8: " outer)"
  - nestingLevel: 1 − 1 = 0 (no new "(" in " outer)")
  - Balanced! Report "((inner) outer)", streamIndices: [0, 15]
```

## Stream Indices

Matches report `streamIndices` as absolute offsets into the full stream, not relative to the current chunk:

```
Stream:       "prefix ((inner) outer) suffix"
               0      7       15      22

Match reported: { isMatch: true, content: "((inner) outer)", streamIndices: [7, 22] }
```

`streamIndices[0]` is the start of the outermost opening delimiter; `streamIndices[1]` is the end of the outermost closing delimiter (exclusive, following the same convention as [`String.prototype.slice`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice)).

## Performance Characteristics

`BalancedPairSearchStrategy` inherits the smart partial-match buffering of `LoopedIndexOfAnchoredSearchStrategy`. Counting nesting adds a linear scan of each new match increment to count opening delimiters, which is proportional to match content size rather than stream size.

| Scenario                         | Characteristic                                                      |
| -------------------------------- | ------------------------------------------------------------------- |
| No matches in stream             | Same cost as anchor strategy — near-zero buffering overhead         |
| Flat (non-nested) matches        | Minimal overhead over anchor strategy — one scan per match          |
| Deeply nested matches            | Proportional to depth × average inner-match size                    |
| Partial matches at boundaries    | Inherits smart buffering — only buffers on genuine partial matches  |

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
  SerialTransformEngine
} from "replace-content-transformer";
import { ReplaceContentTransformer } from "replace-content-transformer/web";

// Replace every top-level balanced `(...)` expression, including nested ones
const transformer = new ReplaceContentTransformer(
  new SerialTransformEngine({
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
  new SerialTransformEngine({
    searchStrategy: strategy,
    replacement: (match: string) => {
      const depth = (match.match(/\(/g) ?? []).length;
      return `/* depth ${depth} */${match}`;
    }
  })
);
```
