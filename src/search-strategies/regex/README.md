# Regex Search Strategy

A generator-based strategy that matches patterns using **regular expressions** with intelligent partial match detection to handle patterns spanning chunk boundaries.

## Algorithm Overview

This strategy uses JavaScript's [`RegExp.prototype.exec`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec) for pattern matching, combined with a partial matching transformation to detect when a chunk might end mid-pattern. Unlike simple string matching, regex patterns can be unbounded (e.g., wildcards), requiring sophisticated logic to determine when to buffer content.

Unlike C/C++ (via [PCRE/PCRE2](https://www.pcre.org/original/doc/html/pcrepartial.html), [RE2](https://github.com/google/re2?tab=readme-ov-file#matching-interface), [Boost.Regex](https://www.boost.org/doc/libs/1_34_1/libs/regex/doc/partial_matches.html)), Python ([via third party regex module](https://pypi.org/project/regex/#:~:text=Added%20partial%20matches)) or Java (via [`hitEnd`](https://docs.oracle.com/javase/8/docs/api/java/util/regex/Matcher.html#hitEnd--)), Javascript has no canonical/innate partial-matching for regular expressions.

This library uses a sibling package ([`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/)) to generate a "partial match" regex on construction, based on the supplied pattern, allowing detection of potential incomplete matches at chunk boundaries, thus allowing buffering only where a continued match is possible.

This has been chosen for simplicity and performance, with libraries such as [`incr-regex-package`](https://www.npmjs.com/package/incr-regex-package), [`dfa`](https://github.com/foliojs/dfa), [`refa`](https://github.com/RunDevelopment/refa), which might provide partial-match capability (and perhaps resolve some of the lookaround [limitations](#limitations)), not evaluated [^1].

To enable optimistic/early yielding, certain regular expression features are unsupported, e.g. [lookbehinds](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion) and negative [lookaheads](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookahead_assertion). [Backreferences](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Backreference) are supported, but carry streaming-specific caveats. See [Limitations](#limitations) for full explanation.

> [!WARNING]
> The strategy yields an object containing `{ content: RegExpExecArray }` for matches (rather than `{ content: string }`), where the `RegExpExecArray` is the result of calling `RegExp.prototype.exec`. This provides access to capture groups via `match.content[1]`, `match.content[2]`, etc., and named groups via `match.content.groups`. The array also includes [`index`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec#index) and [`input`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec#input) properties, which make little sense in a streaming scenario and should be disregarded.

> [!NOTE]
> Where the `d` flag is provided, indices are mapped to be offsets into the stream as a whole. The indices on the match will duplicate the `streamIndices` passed to the replacement function. However, the `groups` property on indices is also updated, which may prove more useful.

## How It Works

### Dual Regex Approach

The strategy maintains two regex patterns:

```typescript
import PartialMatchRegExp from "regex-partial-match";

class RegexSearchStrategy {
  private readonly completeMatchRegex: RegExp; // Original pattern
  private readonly partialMatchRegex: PartialMatchRegExp; // Updated for partial detection

  constructor(needle: RegExp) {
    this.completeMatchRegex = needle;
    this.partialMatchRegex = new PartialMatchRegExp(needle);
  }
}
```

### Scanning with the Partial Regex

The scan uses the **partial** regex: one `exec` per scan position, then a decision on the result. The original pattern settles whatever is left buffered at [End of Stream](#end-of-stream), and confirms candidates for the one lookahead case below.

```
p = partialMatchRegex.exec(remainingHaystack)

  p reaches end-of-haystack  → more input could change it; buffer from p.index, emit the prefix
                               (includes "nothing viable", which holds nothing)
  p ends short of it         → settled; it IS the match — emit it
                               (on a backreference or lookahead pattern, only if hitEnd(p) is false)
```

A candidate that reaches the end of the haystack is deferred without being examined, "nothing viable" included [^2]. Deferral is always safe, because [End of Stream](#end-of-stream) settles whatever is still buffered with the original pattern: `/END/` over `"xxEND"` is held until the next chunk or `flush`, as is `/[A-Z]+/` over `"please MAT"`. Probing such candidates so that some settle a chunk earlier is not worth its cost [^3].

A candidate that ends short of the end is settled outright for most patterns: only the `$(?![\s\S])` truncation marker can make a partial match incomplete, and it only matches at end-of-haystack, so a shorter match is the original pattern's match at that index. That is decided once, at construction, from the partial regex's `features`.

A backreference or lookahead pattern breaks that, so its candidate is also passed to `hitEnd()`, which follows the JDK's [`Matcher.hitEnd()`](https://docs.oracle.com/javase/8/docs/api/java/util/regex/Matcher.html#hitEnd--): `true` means the partial regex read the end of the haystack, so the candidate is deferred; `false` means no continuation can change the match's index or text, so it is settled.

Two properties make this sound:

- **Superset** — the partial regex matches everything the original matches, and never starts later. A partial scan cannot miss what a complete scan would find.
- **Identity** — a candidate settled this way never relied on the truncation marker, so it is the original pattern's match at that index: identical in extent, capture groups and `d`-flag indices. One case is invisible to `hitEnd()` — see [Lookahead Confirmation](#lookahead-confirmation).

### Lookahead Confirmation

Identity holds for the text a match _consumes_, not for what it _asserts_. A positive lookahead is zero-width: its atoms are partialised like everything else, so `(?=bc)` is satisfied by a bare `b` at end-of-haystack. The candidate ends short of the edge, so on a lookahead pattern it is not settled on that alone. `hitEnd()` sees the truncation, because the partial regex read the end inside the assertion:

```
Pattern: /a(?=bc)/
Chunk:   "ab"

partialMatchRegex.exec() → "a" at position 0, ending at 1 of 2
hitEnd()                 → true: the assertion ran into the edge, so "a" is deferred
```

A capture inside the assertion is held the same way: `/a(?=(b+))/` over `"ab"` waits until the capture can no longer grow [^4].

The one thing it cannot see is a lookahead read in an _earlier iteration_ of a quantified group. ECMAScript resets a quantified group's captures on every iteration, including the partial regex's truncation markers, so the evidence is wiped before the match ends:

```
Pattern: /(?:a(?=bcd)|b)+/
Chunk:   "abc"

partialMatchRegex.exec() → "ab" at position 0
hitEnd()                 → false: the (?=bcd) read in iteration 1 is invisible
```

`"abcx"` matches only `"b"` at index 1, so `"ab"` must not be emitted. Where the pattern uses a lookahead, a candidate that `hitEnd()` has settled is therefore confirmed: the original pattern, anchored at the candidate's index, has to produce **the same match**, extent _and_ captures. Otherwise the candidate is buffered from its own index, like a deferred one. The emitted match is the confirmation's own, so `groups` and `d`-flag indices are what a non-streaming `exec` returns. This is a [limit upstream](https://github.com/TomStrepsil/regex-partial-match/issues/123) too.

```
Pattern: /(?:a(?=bcd)|b)+/

  ["abcd"]       → confirmed on the spot → match "ab", then "cd"
  ["abc", "d"]   → "abc" held; "abcd" confirms → match "ab", then "cd"
  ["abc", "x"]   → "abc" held; "abcx" has no match at 0 → "a" as non-match text, then "b" as the match
```

Both the probe and the confirmation are decided once, at construction, from the partial regex's `features`, so a pattern without a lookahead never pays for the confirmation. See [Positive lookaheads](#️-positive-lookaheads) for the cost.

### Settled Match

A partial match that ends before the end of the chunk is final (on a backreference or lookahead pattern, provided `hitEnd()` is `false`), and is emitted as the match:

```
Pattern: /PLACEHOLDER/
Chunk:   "Hello PLACEHOLDER world"

partialMatchRegex.exec() → "PLACEHOLDER" at position 6, ending at 17 of 23

┌─────────────────────────────────────┐
│ Chunk: "Hello PLACEHOLDER world"    │
│               ^^^^^^^^^^^           │
│               ends before the edge  │
└─────────────────────────────────────┘

Result:
  - "Hello " → non-match
  - "PLACEHOLDER" → match
  - " world" → non-match
```

### Deferred Match

A partial match that reaches the end of the chunk might still change, so it is buffered rather than emitted (as is a shorter one on a backreference or lookahead pattern when `hitEnd()` is `true`):

```
Pattern: /PLACEHOLDER/
Chunk:   "Hello PLACE"

partialMatchRegex.exec() → "PLACE" at position 6, ending at 11 of 11

┌──────────────────────────────────────────────┐
│ Chunk: "Hello PLACE"                         │
│               ^^^^^                          │
│               reaches the edge — defer       │
└──────────────────────────────────────────────┘

Output: "Hello " (non-match)
Buffer: "PLACE"
```

This is what makes the strategy chunk-invariant. The same rule covers three hazards that look distinct but are the same question — _does the partial match run into the edge?_

```
Pattern: /foo.?bar|o/          "x fooXbar"
  ["x fo", "oXbar"]            → one match, "fooXbar" (not two `o` matches)

Pattern: /[A-Z]+/              "please MATCH this"
  ["please MAT", "CH this"]    → one match, "MATCH" (not "MAT" + "CH")

Pattern: /\d{4}-\d{2}|\d{4}/   "born 2024-06 ok"
  ["born 2024-", "06 ok"]      → one match, "2024-06" (not "2024")
```

The third defeats a naive guard: `2024` ends well short of the edge, but `2024-` was still a viable prefix of the higher-priority branch. The partial regex prefers that branch, so its candidate reaches the edge and is deferred.

### Buffer Continuation

When the next chunk arrives, combine it with the buffer and re-evaluate:

```
Previous buffer: "PLACE"
Next chunk:      "HOLDER and more"

Combined: "PLACEHOLDER and more"

Step 1: partialMatchRegex.exec() → "PLACEHOLDER" at position 0, ending short of the edge

┌──────────────────────────────────────────────┐
│ Combined: "PLACEHOLDER and more"             │
│            ^^^^^^^^^^^                       │
│            Complete match!                   │
└──────────────────────────────────────────────┘

Result:
  - "PLACEHOLDER" → match
  - " and more" → continue processing
  - buffer: "" (cleared)
```

### Failed Partial Match

If the buffer doesn't complete a match:

```
Previous buffer: "PLACE"
Next chunk:      "BO wrong"

Combined: "PLACEBO wrong"

partialMatchRegex.exec() → nothing viable for "PLACEHOLDER"

┌──────────────────────────────────────────────┐
│ Combined: "PLACEBO wrong"                    │
│                                              │
│ Not a complete or partial match              │
│ Flush buffer                                 │
└──────────────────────────────────────────────┘
```

### End of Stream

Once the stream ends, nothing further can arrive, so whatever is buffered is settled with the **original** pattern — no partial regex, no deferral:

```
Pattern: /abc|b/
Buffer at end of stream: "ab"

completeMatchRegex.exec("ab") → "b" at position 1

┌──────────────────────────────────────────────┐
│ Buffer: "ab"                                 │
│           ^   nothing more can extend it     │
│               so the match is final          │
└──────────────────────────────────────────────┘

Output: "a" (non-match), then "b" (match)
```

Every match found this way is emitted as a real match; whatever never becomes one is emitted as a single trailing non-match segment. This is what allows the scan to defer — content held back at a chunk boundary is still reported as a match if it is one.

> [!NOTE]
> [`flush()`](../types.ts) yields `MatchResult`s, the same union as `processChunk`.

## Partial Match Transformation

See documentation of `regex-partial-match` for explanation of [how it works](https://github.com/TomStrepsil/regex-partial-match/tree/main?tab=readme-ov-file#how-it-works).

**Example transformation:**

```
Original pattern:    /PLACEHOLDER/
Complete regex:      /PLACEHOLDER/
Partial regex:       /(?:P|$(?![\s\S]))(?:L|$(?![\s\S]))(?:A|$(?![\s\S]))(?:C|$(?![\s\S]))(?:E|$(?![\s\S]))(?:H|$(?![\s\S]))(?:O|$(?![\s\S]))(?:L|$(?![\s\S]))(?:D|$(?![\s\S]))(?:E|$(?![\s\S]))(?:R|$(?![\s\S]))/

The partial regex matches progressively:
  "P" or "PL" or "PLA" or "PLAC" ... or "PLACEHOLDER"

This allows detection of incomplete patterns at chunk boundaries.
```

## State Management

```typescript
type RegexSearchState = {
  buffer: string; // Buffered content for a partial match
};
```

**State transitions:**

- **Initial:** `buffer = ""`
- **Complete match found:** Clear buffer, emit match
- **Partial match detected:** Buffer matched portion
- **No match (complete or partial):** Emit content as non-match
- **Flush:** Settle the buffer — emit any matches it still holds, then any trailing content

## Limitations

Due to the streaming nature of the algorithm, or due to the implementation of [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match), certain regex features are problematic:

### ❌ Lookbehinds

```js
/(?<=foo)bar/;
/(?<!foo)bar/;
```

Problem: A chunk beginning with "bar" would naively match.

Knowing to store "foo" in a buffer to negate the match would require a non-native regular expression state machine, or otherwise.

### ❌ Negative lookaheads

```js
/foo(?!bar)/;
```

Problem: A chunk ending "foo" would naively match.

Knowing when to buffer requires understanding if the part of the regular expression next to match is a lookahead. To implement would require a non-native regular expression state machine, or otherwise.

> [!NOTE]
> This restriction is specifically about **predictive** negative lookaheads: ones whose truth depends on content that hasn't arrived yet. `(?!bar)` needs to see, and rule out, up to three more characters before it can be trusted — that's exactly the case this strategy can't support without a full state machine.
>
> It does _not_ apply to [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/)'s own internal use of `(?![\s\S])`, visible in the generated partial regex — e.g. `(?:P|$(?![\s\S]))(?:L|$(?![\s\S]))...` for `/PLACEHOLDER/` (see [Partial Match Transformation](#partial-match-transformation)). That marker only ever asserts absence of _already-received_ content, never a claim about anything still to arrive [^5].
>
> - `(?!bar)` (user pattern): depends on 3 characters not yet received → must know to buffer to find out, despite complete expression matching → **unsupported**.
> - `(?![\s\S])` (internal marker): depends on zero unseen characters, it's an assertion of _absence_ → always decidable immediately → **safe**.

### ❌ Boundary assertions

```js
/^foo/;
/foo$/;
/\bfoo/;
/foo\B/;
```

Problem: `^`, `$`, `\b`, and `\B` all evaluate against whatever string `exec()` happens to be called with — but this strategy re-slices the haystack via `.substring()` on every scan, so that string's own start/end doesn't necessarily line up with the true start/end of the stream. An assertion can wrongly fire right after an earlier match, or at a chunk's trailing edge before it's known whether more content is coming — a confirmed, silently incorrect match, not just imprecision. Rejected by [input validation](./input-validation.ts) rather than silently producing wrong results.

### ❌ Multiline flag

```js
/^foo$/m;
```

Problem: `m` only changes the behaviour of `^` and `$`, both of which are unsupported above — so a pattern using `m` either has no anchors to affect (making the flag a pointless no-op) or has anchors that are already rejected on their own. Rejected by [input validation](./input-validation.ts) for a clearer error at the point of use, rather than silently accepted as a no-op.

### ❌ Global / sticky flags

```js
/foo/g;
/foo/y;
```

Problem: This strategy already finds every match itself by advancing its own cursor, but `exec()`'s `g`/`y` behaviour keeps its own `lastIndex` cursor on the regex object, which goes stale between the strategy's internal calls and can silently drop matches [^6]. Rejected by [input validation](./input-validation.ts) rather than silently stripped.

### ⚠️ Positive lookaheads

```js
/border(?=-top)/;
```

Supported, and chunk-invariant — but the assertion reads content the match itself does not consume, so a candidate cannot be emitted until that content has arrived. Fed `"border"`, the strategy holds it: `-top` may be in the next chunk, or may never come. See [Lookahead Confirmation](#lookahead-confirmation) for the mechanism.

A capture inside the assertion (`/a(?=(b+))/`) is held until it can no longer grow; capturing groups inside a lookahead are accepted.

Two costs follow:

- **Deferral past the end of the match.** A match whose own text ends well inside the chunk is still buffered, for as much content as the lookahead can inspect. That is bounded by the assertion's own length for a fixed one like `(?=-top)`, but a lookahead containing an unbounded quantifier (`/foo(?=.*;)/`) inherits [Unbounded Quantifiers](#️-unbounded-quantifiers) and can hold the buffer to the end of the stream.
- **A `hitEnd()` probe and a second `exec` per candidate.** Every candidate that ends short of the edge is probed, and the ones `hitEnd()` settles cost one anchored `exec` against the original pattern for confirmation. That measured about 1.24x on the lookahead content shape [^7]. Patterns with no lookahead are unaffected.

### ⚠️ Backreferences

```js
/(.+?) \1/;
```

Backreferences are supported, including across chunk boundaries: [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/) resolves captures at match time and re-expands each backreference into per-atom partial form on every `exec()` (see [its documentation](https://github.com/TomStrepsil/regex-partial-match/blob/main/docs/backreferences.md)). `/(.+?) \1/` matches `"foo foo"` split as `"foo f"` + `"oo bar"`, and `/(a)\1b|a/` over `"aa"` + `"b"` yields `"aab"`, not `"a"`, `"a"`, `"b"` [^8].

That comes with real caveats for streaming use:

- **Performance.** Constructing the partial-match regex is slightly more expensive than a native `RegExp`, and a genuine backreference makes the per-chunk `partialMatchRegex.exec()` re-expand it atom by atom rather than use the cheap static partial regex. The `hitEnd()` probe adds about 1.07x on the backreference shape.
- **Prefix-ambiguous top-level alternation can silently drop a match.** When top-level branches share a prefix (`/(ab)\1|(abc)\2/`), the internal capture scan can resolve the shorter branch too early, so the partial match from its true start is not found and a later, shorter candidate is returned instead. The content before that candidate is emitted as text, so the match is **lost** [^9].

> [!TIP]
> List the longer branch _first_ (`/(abc)\1|(ab)\2/`). The capture scan then resolves it first, so the ambiguous prefix stays buffered and the same three chunks give `"abcabc"`. That relies on scan-resolution order rather than a guarantee, so test it against your own pattern.

### ⚠️ Unbounded Quantifiers

```js
/foo.+bar/s;
/foo.+/;
/[A-Z]+/;
/\p{Uppercase_Letter}+/u;
```

Problem: an unbounded quantifier has no reason to stop at a chunk edge. While a match could still grow it is buffered, so the matches are the same however the stream is split, but the memory is not.

The cost is decided by whether the pattern can _settle_:

| Pattern                                 | Peak buffer                            |
| --------------------------------------- | -------------------------------------- |
| `/\{\{[^{}]*\}\}/` over templating text | one pending match (8 chars measured)   |
| `/\{\{[^{}]*\}\}/` over prose           | one pending delimiter prefix           |
| `/foo.+/`                               | the rest of the stream                 |
| `/\S+/` over unbroken text              | the whole stream                       |

A terminator the body cannot consume **bounds** the buffer without emptying it: a match in progress when a chunk ends is held, so the peak is the longest pending match (8 characters for the templating shape in the [content-shape benchmarks](../../../test/benchmarks/regex-shapes/README.md)) and does not grow with the stream.

`/\S+/` over text with no whitespace never reaches a point where more input could not extend the match, so it holds the entire stream; nothing but the next chunk can say whether the run continues. The buffer is also re-scanned from position 0 every chunk, so the cost is **quadratic** in stream length [^10].

> [!TIP]
> Give the pattern a terminator its own body cannot consume:
>
> ```js
> /foo[A-Z]+bar/;
> ```
>
> `bar` ends the match and `[A-Z]+` cannot eat it, so the match settles as soon as it is complete and nothing is held beyond it. Non-greedy quantifiers (`.+?`) help for the same reason.
>
> Ending in a literal is not sufficient on its own. `/x?\w?b/` ends in `b`, but `\w?` can also consume that `b`, so the match cannot settle until the following character is known.

### ⚠️ Zero-length matches

```js
/\d*/;
/a?/;
/(?=a)/;
```

Problem: A pattern that can match the empty string would leave the scan cursor where it is, because the cursor advances by the length of the match. Left alone, that never terminates.

Such a pattern is accepted, but **a zero-length match is never emitted**. The rule is:

> Zero-length matches are skipped, and your replacement function is never called with one. Everything else matches as [`String.prototype.matchAll`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/matchAll) would.

The practical effect is that a nullable pattern matches only where it matches something:

```js
/\d*/;   // matches like /\d+/   — "a12b3c" ➜ "12", "3"
/a?/;    // matches like /a/     — "xaybaaz" ➜ "a", "a", "a"
/(ab)*/; // matches like /(ab)+/
```

Output stays lossless — skipped positions are passed through as ordinary non-matching content — and the same matches are produced however the stream is chunked [^11].

> [!WARNING]
> A pattern that can **only** match empty therefore never matches **anything**, and does so silently: [^12]
>
> ```js
> new RegExp(""); //  never matches
> /(?:)/;         //  never matches
> /(?=a)/;        //  never matches — the lookahead consumes nothing
> /(?!z)/;        //  never matches
> ```

Where a partial match _is_ viable at a position the strategy defers instead of skipping, so `/(a*b)?/` buffers exactly as `/a*b/` does and the limits under [Unbounded Quantifiers](#️-unbounded-quantifiers) apply.

### ⚠️ Surrogate pairs split across chunks

Chunks must not split a surrogate pair. Only whole astral characters are supported, as with [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/blob/main/docs/caveats.md#surrogate-pair-matching). If the source is bytes, decode them with a `TextDecoder` (or `TextDecoderStream`, which never emits half a pair) before the stream reaches the transformer. The strategy has no handling for a pair divided across two chunks.

### ✅ Supported Features

- 🔤 [Literal characters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Literal_character) / simple patterns: `/test/`
- 👀 [Lookahead assertions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookahead_assertion) (positive only): `/foo(?=bar)/` (see [caveats](#️-positive-lookaheads) above)
- 🔢 [Quantifiers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Cheatsheet#quantifiers): `/a{2,4}/`, `/b*?/`, `/c+/` (with caveats above for potential split matching, etc.)
- 📋 [Character classes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Character_class): `/[a-z]/`
- 🔣 [Character escapes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Character_escape): (`\n`, `\t`, `\x61`, `\u0061`, `\u{1F600}`)
- 🧩 [Character class escapes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Character_class_escape): `/\w+/`, `/\d{3}/`
- 🌐 [Unicode character class escapes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape): `/\p{Script_Extensions=Latin}+/u`
- 🧮 [Unicode sets (`v` flag)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/unicodeSets): (`/[\p{Lowercase}&&\p{Script=Greek}]/v`)
- 🔀 [Disjunctions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Disjunction): `/cat|dog/`
- 👥 [Non-capturing groups](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Non-capturing_group): `/(?:hello)+/`
- 👪 Capturing groups (🫥 [unnamed](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Capturing_group) and 📛 [named](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Named_capturing_group)): `/(hello|hi) there (?<name>.+?)/`
- 🔙 [Backreferences](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Backreference) (numbered and named): `/(.+?) \1/`, `/(?<foo>.)\k<foo>/` (see [caveats](#limitations) above)
- 🗂️ [Indices](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Groups_and_backreferences#using_groups_and_match_indices) [^13]: `/foo/d`

## Credits

See [credits](https://github.com/TomStrepsil/regex-partial-match/blob/main/README.md#-credits) for `regex-partial-match`.

[^1]: After significant performance degradation was observed when attempting [knuth-morris-pratt](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm) for static string partial matching, the project has prioritised innate matching capabilities of the language.

[^2]: No viable partial is reported as a zero-length match at end-of-haystack rather than `null`, since the truncation branch always matches the empty string there. It is deferred like any other edge candidate, but buffering from end-of-haystack holds nothing, so the whole remainder is emitted.

[^3]: Measured around 1.3x slower on nearly every content shape, and 2.2x on `/\S+/`, for no gain in time.

[^4]: Likewise `/a(?=(?:b(?:x|(c))d|b))/` is held while the higher-priority branch is still viable.

[^5]: `(?![\s\S])` asserts "no character exists at the current position" — a claim about content already in hand, decidable immediately from the buffer as it stands, never contingent on anything still to arrive. It isn't looking _ahead_ into unseen content at all; it's a boundary check on the known buffer, spelled as a negative lookahead only because that's the native way to express "and nothing follows." It's also confined to the _partial_-match regex, never the original/complete-match regex — its only job is answering "could this still become a match with more input," a permissive buffering decision, not a definitive pass/fail on the match itself. Where it applies, a false positive there just means "keep buffering a little longer," not an incorrectly emitted match. The same reasoning is why `(?=...)` (positive lookahead) is fully supported (see [Supported Features](#-supported-features)) but `(?!...)` isn't: a positive lookahead's own atoms get the same "or buffer more" treatment as the rest of the pattern, so there's no predictive claim being smuggled in. The catch is that the assertion is zero-width, so that "buffer more" has to be read out of the assertion explicitly rather than from where the match ends — see [Lookahead Confirmation](#lookahead-confirmation).

[^6]: Each internal `exec()` call runs against a fresh substring starting where the last match ended, but `lastIndex` (set by the previous `g`/`y` call) is left pointing at an offset within the _previous, longer_ substring. Reused verbatim as an offset into the new, shorter one, it can point past a real match — which then gets flushed as ordinary non-match content instead of surfacing as a match. `y` compounds this: it also refuses to scan forward from `lastIndex` at all, so a match anywhere but exactly there is missed even on the first call.

[^7]: A/B/B/A against the tree before the settle rule. With the confirmation removed, that shape reports 42 matches where a non-streaming `matchAll` over the same content finds 40, so it doubles as a guard on it.

[^8]: With a backreference in play `exec` can return a native match that ignores a higher-priority alternative still running out of input, and the candidate ends short of the edge. That is the case `hitEnd()` is consulted for.

[^9]: `/(ab)\1|(abc)\2/` fed `"ab"`, `"ca"`, `"bc"` yields the single non-match `"abcabc"` instead of the match `"abcabc"` a non-chunked `exec()` finds. The partial regex returns `"a"` at index 3 for `"abca"` rather than the partial match at 0.

[^10]: Measured 23 µs at 1.5 KB, 323 µs at 6 KB and 4.99 ms at 24 KB, roughly 4× per doubling.

[^11]: A skipped zero-length match advances the cursor by one **code unit**, so it can split a surrogate pair across two non-match segments. Output remains lossless, and no match is affected. Chunks are expected never to split a pair in the first place (see [Surrogate pairs split across chunks](#️-surrogate-pairs-split-across-chunks)).

[^12]: These are almost always a mistake. Nothing is thrown, because deciding "can this pattern _only_ match empty" requires parsing the pattern rather than testing it — `/(?=a)/.test("")` is `false`, and `/a?/.test("")` is `true` despite `/a?/` being perfectly usable.

[^13]: See note within [algorithm overview](#algorithm-overview) regarding indices mapping.
