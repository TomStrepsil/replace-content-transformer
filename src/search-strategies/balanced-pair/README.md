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
   Balanced! Yield "((inner) outer)" as a match
```

**Without nesting awareness:**

```
Anchor strategy alone:
  Input:  "((inner) outer)"
  Match:  "((inner)"    ← stops at first ), incomplete!
```

## Implementation Details

`BalancedPairSearchStrategy` wraps `LoopedIndexOfAnchoredSearchStrategy` and post-processes each match it yields:

```typescript
class BalancedPairSearchStrategy implements SearchStrategy<
  BalancedPairSearchState,
  string
> {
  private anchorStringSearchStrategy: LoopedIndexOfAnchoredSearchStrategy;

  constructor(opening: string, closing: string) {
    this.anchorStringSearchStrategy = new LoopedIndexOfAnchoredSearchStrategy([
      opening,
      closing
    ]);
  }
}
```

When the underlying anchor strategy yields a match (opening–closing pair found), the balanced pair strategy:

1. Counts any additional opening delimiters within the new match content
2. Adjusts `nestingLevel` accordingly
3. If `nestingLevel > 0`, resets `currentNeedleIndex = 1` on the shared state so the anchor strategy resumes scanning for the next closing delimiter — without discarding already-accumulated match content
4. Accumulates content in `balancedBuffer` until `nestingLevel` returns to zero, then yields the whole span as a single match

### Incremental Content Tracking

The underlying anchor strategy's match content grows cumulatively (from the first opening needle to each subsequent closing needle). The balanced pair strategy slices only the _new_ portion of each yielded match to count openings in it:

```typescript
const newContent = matchResult.content.slice(prevMatchLength);
prevMatchLength = matchResult.content.length;
// ...
state.nestingLevel--;
let cursor = 0;
while ((cursor = newContent.indexOf(this.opening, cursor)) !== -1) {
  state.nestingLevel++;
  cursor += this.opening.length;
}
```

This ensures each opening is counted exactly once, regardless of how many intermediate closing delimiters were found.

### Inner Buffer Adjustment

When `nestingLevel > 0` and the underlying strategy's buffer still holds in-flight content, the balanced pair strategy trims the anchor strategy's buffer to exclude content already accounted for in `balancedBuffer`:

```typescript
if (state.nestingLevel > 0) {
  state.buffer = state.buffer.slice(state.balancedBuffer.length);
}
```

This prevents double-counting when the anchor strategy's cross-chunk buffer is combined with the next chunk.

## State Management

`BalancedPairSearchState` extends `LoopedIndexOfAnchoredSearchState`:

```typescript
interface BalancedPairSearchState extends LoopedIndexOfAnchoredSearchState {
  /** How many unmatched opening delimiters have been seen inside the current match */
  nestingLevel: number;
  /** Accumulated content of the outermost balanced match in progress */
  balancedBuffer: string;
  /** Absolute stream offset at which the outermost opening delimiter was found */
  balancedBufferStart: number;
}
```

**State transitions:**

| Condition                         | `nestingLevel`        | `balancedBuffer`           | Action                                 |
| --------------------------------- | --------------------- | -------------------------- | -------------------------------------- |
| No match found                    | unchanged (0)         | `""`                       | Pass through as non-match              |
| Opening found, no inner opens     | `0` (after `--` + 0)  | accumulated → cleared      | Yield as complete match                |
| Opening found, inner opens exist  | `> 0`                 | accumulating               | Set `currentNeedleIndex = 1`, continue |
| Subsequent close balances depth   | decrements toward `0` | accumulating               | Continue or yield when reaching `0`    |
| Flush mid-match                   | reset to `0`          | cleared (returned as-is)   | Return buffered content unflushed      |

**Flush behaviour:**

If a stream ends while a balanced match is in progress (e.g. `((inner)` with no outer `)`), `flush` yields all accumulated content in `balancedBuffer` plus any remaining content in the anchor strategy's buffer, as non-match results:

```typescript
*flush(state: BalancedPairSearchState): Generator<MatchResult, void, undefined> {
  const flushed = state.balancedBuffer;
  state.balancedBuffer = "";
  state.balancedBufferStart = 0;
  state.nestingLevel = 0;
  if (flushed) yield { isMatch: false, content: flushed };
  yield* this.anchorStringSearchStrategy.flush(state);
}
```

## Cross-Chunk Matching

The strategy correctly handles matches that span chunk boundaries at every level:

```
Opening: "("   Closing: ")"
Chunk 1: "((inner)"
Chunk 2: " outer)"

Process Chunk 1:
  - Anchor strategy finds "((inner)" as match
  - nestingLevel: 0 − 1 + 2 = 1 (two "(" inside, one ")" closes)
  - currentNeedleIndex reset to 1 — continue scanning for ")"
  - balancedBuffer: "((inner)"

Process Chunk 2:
  - Anchor strategy finds " outer)" as the continuation
  - nestingLevel: 1 − 1 = 0 (no new "(" in " outer)")
  - Balanced! Yield "((inner) outer)", streamIndices: [0, 15]
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
