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
  private readonly partialMatchRegex: RegExp; // Updated for partial detection

  constructor(needle: RegExp) {
    this.completeMatchRegex = needle;
    this.partialMatchRegex = new PartialMatchRegExp(needle);
  }
}
```

### Scanning with the Partial Regex

The scan uses the **partial** regex: one `exec` per scan position, and (for every pattern that does not use a lookahead) that result is the answer. The original pattern settles whatever is left buffered at [End of Stream](#end-of-stream), and confirms candidates for the lookahead case below.

```
p = partialMatchRegex.exec(remainingHaystack)

  nothing viable            → nothing here can ever match; emit the remainder
  p reaches end-of-haystack → still growing; buffer from p.index, emit the prefix
  p ends before the end     → settled; it IS the match — emit it
```

Two properties make this sound:

- **Superset** — the partial regex matches everything the original matches, and never starts later. A partial scan cannot miss what a complete scan would find.
- **Identity** — an _incomplete_ partial match can only end at end-of-haystack, because that is what the `$(?![\s\S])` truncation marker asserts. So a partial match ending _before_ end-of-haystack cannot have used that branch: it is the original pattern's match at that index, identical in extent, capture groups and `d`-flag indices. A zero-width assertion is the exception, since the branch it takes cannot move where the match ends — see [Lookahead Confirmation](#lookahead-confirmation).

Note that "nothing viable" is reported as a zero-length match at end-of-haystack rather than as `null` — the truncation branch always matches the empty string there.

### Lookahead Confirmation

Identity holds for the text a match _consumes_, not for what it _asserts_. A positive lookahead is zero-width: its atoms are partialised like everything else, so `(?=bc)` is satisfied by a bare `b` at end-of-haystack — but that truncation happens _inside_ the assertion, where it cannot extend the match's own end.

```
Pattern: /a(?=bc)/
Chunk:   "ab"

partialMatchRegex.exec() → "a" at position 0, ending at 1 of 2

┌──────────────────────────────────────────────┐
│ Chunk: "ab"                                  │
│         ^     ends before the edge …         │
│          ^    … but the lookahead ran into it│
└──────────────────────────────────────────────┘
```

By the rule above that candidate is settled — yet `/a(?=bc)/` does not match `"ab"` at all. So where the pattern uses a lookahead, a settled candidate is confirmed before it is emitted: the original pattern, anchored at the candidate's index, has to match there with the same extent. Where it does not, the candidate is treated as still growing, and buffered from its own index exactly like a partial that reached the edge.

```
Pattern: /a(?=bc)/

  ["abc"]      → confirmed on the spot → match "a", then "bc"
  ["ab", "c"]  → "ab" held; "abc" confirms → match "a", then "bc"
  ["ab", "X"]  → "ab" held; "abX" can never match → "abX" as non-match text
```

The check is decided once, at construction, from the partial regex's `features` — a pattern with no lookahead never pays for it and keeps the single-`exec` scan. See [Positive lookaheads](#️-positive-lookaheads) for what it costs the ones that do.

### Settled Match

A partial match that ends before the end of the chunk is final, and is emitted as the match:

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

A partial match that runs to the end of the chunk might still grow, so it is buffered rather than emitted:

```
Pattern: /PLACEHOLDER/
Chunk:   "Hello PLACE"

partialMatchRegex.exec() → "PLACE" at position 6, ending at 11 of 11

┌──────────────────────────────────────────────┐
│ Chunk: "Hello PLACE"                         │
│               ^^^^^                          │
│               runs to the edge — defer       │
└──────────────────────────────────────────────┘

Output: "Hello " (non-match)
Buffer: "PLACE"
```

This is what makes the strategy chunk-invariant. The same rule covers three hazards that look distinct but are the same question — _is anything starting here still growing?_

```
Pattern: /foo.?bar|o/    "x fooXbar"
  ["x fo", "oXbar"]  → one match, "fooXbar"   (not two `o` matches)

Pattern: /[A-Z]+/        "please MATCH this"
  ["please MAT", "CH this"]  → one match, "MATCH"   (not "MAT" + "CH")

Pattern: /\d{4}-\d{2}|\d{4}/    "born 2024-06 ok"
  ["born 2024-", "06 ok"]  → one match, "2024-06"   (not "2024")
```

The third is the one that defeats a naive guard: `2024` ends at index 9 of a 10-character chunk, comfortably short of the edge, while `2024-` was still a viable prefix of the higher-priority branch. Comparing where the candidates _start_ finds nothing to prefer — only the partial match reaching end-of-haystack reveals it.

### Buffer Continuation

When the next chunk arrives, combine it with the buffer and re-evaluate:

```
Previous buffer: "PLACE"
Next chunk:      "HOLDER and more"

Combined: "PLACEHOLDER and more"

Step 1: completeMatchRegex.exec() → match at position 0

┌──────────────────────────────────────────────┐
│ Combined: "PLACEHOLDER and more"             │
│            ^^^^^^^^^^^                       │
│            Complete match!                   │
└──────────────────────────────────────────────┘

Result:
  - "PLACEHOLDER" → match
  - " and more" → continue processing
  - matchBuffer: "" (cleared)
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
> [`flush()`](../types.ts) yields `MatchResult`s, the same union as `processChunk`. Anyone implementing `SearchStrategy`, or driving a strategy directly, has to handle that — see the [v3 → v4 codemods](../../../codemods/transforms/v3-v4/README.md).

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
> It does _not_ apply to [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/)'s own internal use of `(?![\s\S])`, visible in the generated partial regex — e.g. `(?:P|$(?![\s\S]))(?:L|$(?![\s\S]))...` for `/PLACEHOLDER/` (see [Partial Match Transformation](#partial-match-transformation)). That marker only ever asserts absence of _already-received_ content, never a claim about anything still to arrive[^2].
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

Problem: This strategy already finds every match itself by advancing its own cursor, but `exec()`'s `g`/`y` behaviour keeps its own `lastIndex` cursor on the regex object, which goes stale between the strategy's internal calls and can silently drop matches[^3]. Rejected by [input validation](./input-validation.ts) rather than silently stripped.

### ⚠️ Positive lookaheads

```js
/border(?=-top)/;
```

Supported, and chunk-invariant — but the assertion reads content the match itself does not consume, so a candidate cannot be emitted until that content has arrived. Fed `"border"`, the strategy holds it: `-top` may be in the next chunk, or may never come. See [Lookahead Confirmation](#lookahead-confirmation) for the mechanism.

Two costs follow:

- **Deferral past the end of the match.** A match whose own text ends well inside the chunk is still buffered, for as much content as the lookahead can inspect. That is bounded by the assertion's own length for a fixed one like `(?=-top)`, but a lookahead containing an unbounded quantifier (`/foo(?=.*;)/`) inherits [Unbounded Quantifiers](#️-unbounded-quantifiers) and can hold the buffer to the end of the stream.
- **A second `exec` per candidate.** Confirmation costs one anchored `exec` against the original pattern for every candidate the scan would otherwise settle on the spot — including the ones it goes on to rule out. On the lookahead shape in the [content-shape benchmarks](../../../test/benchmarks/regex-shapes/README.md) that measured around a fifth slower, on a single-machine before/after rather than the A/B/B/A method that suite recommends. Patterns with no lookahead are unaffected.

That shape doubles as a guard on the confirmation itself: with the check removed it reports 42 matches where a non-streaming `matchAll` over the same content finds 40.

### ⚠️ Backreferences

```js
/(.+?) \1/;
```

Backreferences are supported, including across chunk boundaries: [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/) resolves captures at match time and re-expands each backreference into per-atom partial form on every `exec()` call (see [its documentation](https://github.com/TomStrepsil/regex-partial-match/blob/main/docs/backreferences.md) for the full algorithm). For example, `/(.+?) \1/` correctly matches `"foo foo"` split as `"foo f"` + `"oo bar"`.

That comes with real caveats for streaming use:

- **Performance.** Constructing the partial-match regex class is slightly more expensive than constructing the equivalent native `RegExp`. Patterns that do contain a genuine backreference pay a further cost on the one `partialMatchRegex.exec()` call per chunk described in [Scanning with the Partial Regex](#scanning-with-the-partial-regex) above: instead of matching against the cheap static partial regex used otherwise, that call has to re-expand the backreference from its captured value, atom by atom.
- **Prefix-ambiguous top-level alternation can silently drop a match.** When a top-level `|` has branches sharing a prefix (e.g. `/^(ab)\1|^(abc)\2/`, where the first branch's `"ab"` is a strict prefix of the second branch's `"abc"`), the internal capture scan can resolve the _shorter_ branch before enough input has arrived, causing the partial-match `exec()` to return `null` for content that is in fact a valid partial match. Since [`processChunk`](./search-strategy.ts) treats a `null` partial-match result as "definitely not a match" — flushing what's buffered as ordinary non-match content, rather than continuing to buffer it — this isn't just a slower path, it's a **lost match**: `/^(ab)\1|^(abc)\2/` fed `"ab"`, then `"ca"`, then `"bc"` yields two non-matches (`"abca"`, `"bc"`) instead of the single match `"abcabc"` a non-chunked `exec()` on the concatenated string would find.

> [!TIP]
> List the longer/more specific branch _first_ in the alternation (`/^(abc)\1|^(ab)\2/` rather than `/^(ab)\1|^(abc)\2/`) when branches share a prefix. This has been verified to avoid the dropped-match case above — the capture scan then resolves the longer branch first, so the ambiguous prefix stays buffered instead of being flushed as a non-match, and the same three chunks (`"ab"`, `"ca"`, `"bc"`) go on to produce the correct `"abcabc"` match. This depends on scan-resolution order rather than being a documented guarantee, so treat it as a mitigation to test against your own pattern, not a fix.

- **`\k<name>` with no named capturing groups in the pattern** is treated by `regex-partial-match` as an atomic (all-or-nothing) backreference, rather than the [identity escape](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Character_escape) [Annex B](https://tc39.es/ecma262/#sec-regular-expressions-patterns) would otherwise permit — so `"k"` or `"k<"` alone won't register as a valid partial match if this is the pattern's only reference to `\k`. This is a narrow edge case; if the deprecated Annex B identity-escape meaning is actually intended, use `k` instead of `\k`.

### ⚠️ Unbounded Quantifiers

```js
/foo.+bar/s;
/foo.+/;
/[A-Z]+/;
/\p{Uppercase_Letter}+/u;
```

Problem: an unbounded quantifier has no reason to stop at a chunk edge. While a match could still grow, it is buffered rather than emitted — so the matches are the same however the stream is split, but the memory is not.

The cost is decided by whether the pattern can _settle_:

| Pattern                                 | Peak buffer over 20 chunks |
| --------------------------------------- | -------------------------- |
| `/\{\{[^{}]*\}\}/` over templating text | 0                          |
| `/\{\{[^{}]*\}\}/` over prose           | 0                          |
| `/foo.+/`                               | the rest of the stream     |
| `/\S+/` over unbroken text              | the whole stream           |

`/\S+/` over text with no whitespace never reaches a point where more input could not extend the match, so it holds the entire stream. There is no way around that in a streaming scan — nothing but the next chunk can say whether the run continues — and re-scanning a growing buffer each chunk costs time as well as memory (measured ~3.4× on that shape).

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
/\d*/; // matches like /\d+/  — "a12b3c" ➜ "12", "3"
/a?/; //  matches like /a/    — "xaybaaz" ➜ "a", "a", "a"
/(ab)*/; // matches like /(ab)+/
```

Output stays lossless — skipped positions are passed through as ordinary non-matching content — and the same matches are produced however the stream is chunked.

> [!WARNING]
> A pattern that can **only** match empty therefore never matches **anything**, and does so silently:[^4]
>
> ```js
> new RegExp(""); //  never matches
> /(?:)/; //          never matches
> /(?=a)/; //         never matches — the lookahead consumes nothing
> /(?!z)/; //         never matches
> ```

Where a zero-length match is skipped, the cursor advances by one **code unit**, not one code point — so a surrogate pair is never split by the skip. Output remains lossless either way.

Skipping is not the whole story for a nullable pattern: where a partial match _is_ possible at that position, the strategy buffers instead, so the same buffering limits described under [Unbounded Quantifiers](#️-unbounded-quantifiers) above still apply. `/(a*b)?/` buffers exactly as `/a*b/` does.
A skipped zero-length match is the one place the cursor still advances on chunk-relative grounds, so the [Deferred Match](#deferred-match) rule does not apply to it. Where a partial match _is_ viable at that position the strategy defers instead, so nullable patterns buffer exactly as their non-nullable equivalents do.

Both the invariant and the split-dependent cases are pinned in [`search-strategy.test.ts`](./search-strategy.test.ts), driven over every two-way, three-way and per-character split of their input.

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
- 🗂️ [Indices](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Groups_and_backreferences#using_groups_and_match_indices)[^5]: `/foo/d`

## Credits

See [credits](https://github.com/TomStrepsil/regex-partial-match/blob/main/README.md#-credits) for `regex-partial-match`.

[^1]: After significant performance degradation was observed when attempting [knuth-morris-pratt](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm) for static string partial matching, the project has prioritised innate matching capabilities of the language.

[^2]: `(?![\s\S])` asserts "no character exists at the current position" — a claim about content already in hand, decidable immediately from the buffer as it stands, never contingent on anything still to arrive. It isn't looking _ahead_ into unseen content at all; it's a boundary check on the known buffer, spelled as a negative lookahead only because that's the native way to express "and nothing follows." It's also confined to the _partial_-match regex, never the original/complete-match regex — its only job is answering "could this still become a match with more input," a permissive buffering decision, not a definitive pass/fail on the match itself. Where it applies, a false positive there just means "keep buffering a little longer," not an incorrectly emitted match. The same reasoning is why `(?=...)` (positive lookahead) is fully supported (see [Supported Features](#-supported-features)) but `(?!...)` isn't: a positive lookahead's own atoms get the same "or buffer more" treatment as the rest of the pattern, so there's no predictive claim being smuggled in. The catch is that the assertion is zero-width, so that "buffer more" has to be read out of the assertion explicitly rather than from where the match ends — see [Lookahead Confirmation](#lookahead-confirmation).

[^3]: Each internal `exec()` call runs against a fresh substring starting where the last match ended, but `lastIndex` (set by the previous `g`/`y` call) is left pointing at an offset within the _previous, longer_ substring. Reused verbatim as an offset into the new, shorter one, it can point past a real match — which then gets flushed as ordinary non-match content instead of surfacing as a match. `y` compounds this: it also refuses to scan forward from `lastIndex` at all, so a match anywhere but exactly there is missed even on the first call.

[^4]: These are almost always a mistake. Nothing is thrown, because deciding "can this pattern _only_ match empty" requires parsing the pattern rather than testing it — `/(?=a)/.test("")` is `false`, and `/a?/.test("")` is `true` despite `/a?/` being perfectly usable.

[^5]: See note within [algorithm overview](#algorithm-overview) regarding indices mapping.
