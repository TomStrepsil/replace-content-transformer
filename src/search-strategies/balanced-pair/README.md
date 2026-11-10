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
     match starts       first )          outer )
     nestingLevel=0     found             found

 On first ) at position 7:
   nestingLevel-- → -1
   Count "(" in "((inner)": two openings → nestingLevel = -1 + 2 = 1
   Not yet balanced (nestingLevel > 0) — keep looking for more ")"

 On outer ) at position 14:
   nestingLevel-- → 0
   Count "(" in " outer)": zero openings → nestingLevel = 0
   Balanced! Report "((inner) outer)" as a match
```

**Without nesting awareness:**

```
Anchor strategy alone:
  Input:  "((inner) outer)"
  Match:  "((inner)"    ← stops at first ), incomplete!
```

## Implementation Details

`BalancedPairSearchStrategy` wraps `LoopedIndexOfAnchoredSearchStrategy`, passing it a sink that post-processes each match it reports:

```typescript
class BalancedPairSearchStrategy implements SearchStrategy<
  BalancedPairSearchState,
  string
> {
  private anchorStringSearchStrategy: LoopedIndexOfAnchoredSearchStrategy;

  constructor(opening: string, closing: string, options?: BufferGuardOptions) {
    this.anchorStringSearchStrategy = new LoopedIndexOfAnchoredSearchStrategy(
      [opening, closing],
      options
    );
  }
}
```

When the underlying anchor strategy reports a match (opening–closing pair found), the balanced pair strategy:

1. Counts any additional opening delimiters within the new match content
2. Adjusts `nestingLevel` accordingly
3. If `nestingLevel > 0`, resets `currentNeedleIndex = 1` on the shared state so the anchor strategy resumes scanning for the next closing delimiter, still from the pair's opening
4. Once `nestingLevel` returns to zero, reports the anchor strategy's match as it is: it runs from the pair's opening to this closing, so its content and `streamIndices` are the whole pair

### Incremental Content Tracking

The underlying anchor strategy's match content grows cumulatively (from the opening to each subsequent closing). The balanced pair strategy counts openings only in the _new_ portion of each reported match, less one for the closing that ended it:

```typescript
state.nestingLevel += this.#countOpenings(match.slice(this.#countedLength)) - 1;
if (state.nestingLevel > 0) {
  this.#countedLength = match.length;
  state.currentNeedleIndex = 1;
  return true;
}
```

`countOpenings` is a `while`/`indexOf` loop over that portion.

This ensures each opening is counted exactly once, regardless of how many intermediate closing delimiters were found.

### Across Chunks

While a pair is open, the anchor strategy holds it from its opening, and `matchConsumedLength` marks the end of the last closing found. The next chunk resumes the search for a closing there, and counting resumes from the same point, so nothing is counted twice:

```typescript
this.#countedLength = state.nestingLevel > 0 ? state.matchConsumedLength : 0;
```

## Buffer limit

The guard options are passed to the anchor strategy, whose match is the whole pair, from its opening. So a pair still unbalanced `maxBufferLength` code units (65,536 by default) after its opening passes through as text up to there, `onGuardExceeded` is called, and the search restarts right after. When the anchor strategy releases text, the balanced pair strategy resets `nestingLevel` to zero:

```typescript
const strategy = new BalancedPairSearchStrategy("(", ")", { maxBufferLength: 5 });
// "(a(b)(c)d)e" → "(a(b)" as text, then "(c)" as a match, then "d)e" as text
// "( unclosed …" → output resumes once 5 code units from "(" have arrived
```

The decision depends only on the text, so it is the same however the input is split. A limit shorter than the opening and closing together, under which nothing could match, throws a `RangeError`. See [Buffer limit](../../../README.md#buffer-limit).

## State Management

`BalancedPairSearchState` extends `LoopedIndexOfAnchoredSearchState`:

```typescript
interface BalancedPairSearchState extends LoopedIndexOfAnchoredSearchState {
  /** How many unmatched opening delimiters have been seen inside the current match */
  nestingLevel: number;
  /** The sink passed to the anchor strategy, which counts nesting before reporting to the engine's sink */
  nestingSink: NestingSink;
}
```

`createState` makes one `nestingSink` per stream, and each `processChunk` points it at the engine's sink and the state with `reportTo(sink, state)`, so no sink is built per call.

**State transitions:**

| Condition                        | `nestingLevel`        | Action                                     |
| -------------------------------- | --------------------- | ------------------------------------------ |
| No match found                   | unchanged (0)         | Pass through as non-match                  |
| Opening found, no inner opens    | `0` (after `--` + 1)  | Report as complete match                   |
| Opening found, inner opens exist | `> 0`                 | Set `currentNeedleIndex = 1`, continue     |
| Subsequent close balances depth  | decrements toward `0` | Continue, or report when reaching `0`      |
| Anchor strategy releases text    | reset to `0`          | Pass through as non-match                  |
| Flush mid-match                  | reset to `0`          | Return the anchor strategy's held content  |

**Flush behaviour:** if a stream ends while a pair is open (e.g. `((inner)` with no outer `)`), `flush` returns what the anchor strategy holds, the pair from its opening, and resets `nestingLevel`.

**Stopping early:**

When the engine's sink returns `false` for a pair, e.g. once `stopReplacingSignal` aborts, the inner strategy stops and leaves everything after it in the state, so `flush` returns it and `processChunk("")` carries on from it. The wrapping sink returns `true` for an inner match that leaves the pair open, so the search can only stop at a whole pair and never leaves one half-recorded.

## Cross-Chunk Matching

The strategy correctly handles matches that span chunk boundaries at every level:

```
Opening: "("   Closing: ")"
Chunk 1: "((inner)"
Chunk 2: " outer)"

Process Chunk 1:
  - Anchor strategy finds "((inner)" as match
  - nestingLevel: 0 − 1 + 2 = 1 (two "(" inside, one ")" closes)
  - currentNeedleIndex reset to 1: continue scanning for ")"
  - Chunk ends: the anchor strategy holds "((inner)", matchConsumedLength 8

Process Chunk 2:
  - Anchor strategy finds "((inner) outer)", counted from 8: " outer)"
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

`BalancedPairSearchStrategy` inherits the smart partial-match buffering of `LoopedIndexOfAnchoredSearchStrategy`. The nesting layer adds a linear scan of each new match increment to count opening delimiters, which is proportional to match content size rather than stream size.

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
