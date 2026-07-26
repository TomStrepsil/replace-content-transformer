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
> Where the `d` flag is provided, indices are mapped to be offsets into the stream as a whole.  The indices on the match will duplicate the `streamIndices` passed to the replacement function.  However, the `groups` property on indices is also updated, which may prove more useful.

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

### Complete Match Detection

First, attempt to find complete matches using the original pattern:

```
Pattern: /PLACEHOLDER/
Chunk:   "Hello PLACEHOLDER world"

Step 1: completeMatchRegex.exec() → match at position 6

┌─────────────────────────────────────┐
│ Chunk: "Hello PLACEHOLDER world"    │
│               ^^^^^^^^^^^           │
│               Complete match found  │
└─────────────────────────────────────┘

Result:
  - "Hello " → non-match
  - "PLACEHOLDER" → match
  - " world" → non-match
```

### Partial Match Detection

When no complete match is found, use the partial regex to detect potential incomplete patterns:

```
Pattern: /PLACEHOLDER/
Chunk:   "Hello PLACE"

Step 1: completeMatchRegex.exec() → no match
Step 2: partialMatchRegex.exec() → match at position 6

┌──────────────────────────────────────────────┐
│ Chunk: "Hello PLACE"                         │
│               ^^^^^                          │
│               Partial match detected         │
│                                              │
│ Partial regex matches "PLACE" (incomplete)   │
│ Buffer "PLACE" for next chunk                │
└──────────────────────────────────────────────┘

State:
  - matchBuffer: "PLACE"

Output: "Hello " (non-match)
Buffer: "PLACE"
```

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

Step 1: completeMatchRegex.exec(/PLACEHOLDER/) → no match
Step 2: partialMatchRegex.exec() → no match for "PLACEHOLDER"

┌──────────────────────────────────────────────┐
│ Combined: "PLACEBO wrong"                    │
│                                              │
│ Not a complete or partial match              │
│ Flush buffer                                 │
└──────────────────────────────────────────────┘
```

### Addendum: Boundary Assertion Verification

`^` (without `m`), `\b`, `\B`, and `^` under `/m` are zero-width assertions that depend on whatever precedes the current position — [lookbehind](#-lookbehinds) in microcosm, but bounded to exactly one character rather than an arbitrary run, which is what makes it solvable here. Every `.substring()` call in the walkthrough above (see [Complete Match Detection](#complete-match-detection)) hands `exec()` a **new string object** with no memory of what came before it, so native regex treats that string's own index 0 as the true start even when it isn't — regardless of whether the slice happens to start at a chunk boundary or simply right after the previous match, in a single, entirely un-chunked call[^5]:

```
Pattern: /\bOLD/
completeMatchRegex.exec("OLDOLD".slice(3))  →  wrongly matches "OLD" at index 0
  (real preceding char is 'D', a word char - no real \b there)
```

The fix: retain **one real character of trailing context** (the last character actually emitted across a chunk boundary, or the real character already in the haystack for a mid-buffer position), and re-verify any candidate starting at index 0 against it using a sticky-anchored clone of the pattern, forced to start exactly past that character[^6]. A rejected candidate resumes the search one code point later rather than abandoning it entirely[^7].

Patterns without `^`, `\b`, or `\B` at all skip this path entirely (checked once, at construction).

> [!NOTE]
> This resolves the illusion at the *start* of a match only. The same illusion at the *end* of a match (`$`, `\b`/`\B` at the tail) remains unresolved — see [Limitations](#limitations).

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
  precedingChar: string | undefined; // Last real character emitted, for boundary assertion verification (see above)
};
```

**State transitions:**

- **Initial:** `buffer = ""`, `precedingChar = undefined` (true start of stream)
- **Complete match found:** Clear buffer, emit match
- **Partial match detected:** Buffer matched portion
- **No match (complete or partial):** Emit content as non-match
- **Content emitted (match or non-match):** `precedingChar` updated to the last character actually emitted; left unchanged if nothing was emitted this call (e.g. everything buffered as a pending partial match)
- **Flush:** Return buffered content, reset `precedingChar` to `undefined` (a reused state starts a fresh stream)

## Limitations

Due to the streaming nature of the algorithm, or due to the implementation of [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match), certain regex features are problematic:

### ❌ Lookbehinds

```js
/(?<=foo)bar/;
/(?<!foo)bar/;
```

Problem: A chunk beginning with "bar" would naively match.

Knowing to store "foo" in a buffer to negate the match would require a non-native regular expression state machine, or otherwise.

> [!NOTE]
> `^`, `\b`, and `\B` pose the same fundamental problem — needing to know what precedes the current position — but only ever need to look back exactly *one* character, never an arbitrary run like `foo` above. That fixed width is what makes them solvable without a state machine; see [Boundary Assertion Verification](#addendum-boundary-assertion-verification).

### ❌ Negative lookaheads

```js
/foo(?!bar)/;
```

Problem: A chunk ending "foo" would naively match.

Knowing when to buffer requires understanding if the part of the regular expression next to match is a lookahead. To implement would require a non-native regular expression state machine, or otherwise.

> [!NOTE]
> This restriction is specifically about **predictive** negative lookaheads: ones whose truth depends on content that hasn't arrived yet. `(?!bar)` needs to see, and rule out, up to three more characters before it can be trusted — that's exactly the case this strategy can't support without a full state machine.
>
> It does *not* apply to [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/)'s own internal use of `(?![\s\S])`, visible in the generated partial regex — e.g. `(?:P|$(?![\s\S]))(?:L|$(?![\s\S]))...` for `/PLACEHOLDER/` (see [Partial Match Transformation](#partial-match-transformation)). That marker only ever asserts absence of *already-received* content, never a claim about anything still to arrive[^4].
>
> - `(?!bar)` (user pattern): depends on 3 characters not yet received → must know to buffer to find out, despite complete expression matching → **unsupported**.
> - `(?![\s\S])` (internal marker): depends on zero unseen characters, it's an assertion of *absence* → always decidable immediately → **safe**.

### ❌ Global / sticky flags

```js
/foo/g;
/foo/y;
```

Problem: This strategy already finds every match itself by advancing its own cursor, but `exec()`'s `g`/`y` behaviour keeps its own `lastIndex` cursor on the regex object, which goes stale between the strategy's internal calls and can silently drop matches[^3]. Rejected by [input validation](./input-validation.ts) rather than silently stripped.

### ⚠️ Backreferences

```js
/(.+?) \1/;
```

Backreferences are supported, including across chunk boundaries: [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/) resolves captures at match time and re-expands each backreference into per-atom partial form on every `exec()` call (see [its documentation](https://github.com/TomStrepsil/regex-partial-match/blob/main/docs/backreferences.md) for the full algorithm). For example, `/(.+?) \1/` correctly matches `"foo foo"` split as `"foo f"` + `"oo bar"`.

That comes with real caveats for streaming use:

- **Performance.** Constructing the partial-match regex class is slightly more expensive than constructing the equivalent native `RegExp`. Patterns that do contain a genuine backreference pay a further cost on the one `partialMatchRegex.exec()` call per chunk described in [Partial Match Detection](#partial-match-detection) above: instead of matching against the cheap static partial regex used otherwise, that call has to re-expand the backreference from its captured value, atom by atom.
- **Prefix-ambiguous top-level alternation can silently drop a match.** When a top-level `|` has branches sharing a prefix (e.g. `/^(ab)\1|^(abc)\2/`, where the first branch's `"ab"` is a strict prefix of the second branch's `"abc"`), the internal capture scan can resolve the *shorter* branch before enough input has arrived, causing the partial-match `exec()` to return `null` for content that is in fact a valid partial match. Since [`processChunk`](./search-strategy.ts) treats a `null` partial-match result as "definitely not a match" — flushing what's buffered as ordinary non-match content, rather than continuing to buffer it — this isn't just a slower path, it's a **lost match**: `/^(ab)\1|^(abc)\2/` fed `"ab"`, then `"ca"`, then `"bc"` yields two non-matches (`"abca"`, `"bc"`) instead of the single match `"abcabc"` a non-chunked `exec()` on the concatenated string would find.

> [!TIP]
> List the longer/more specific branch *first* in the alternation (`/^(abc)\1|^(ab)\2/` rather than `/^(ab)\1|^(abc)\2/`) when branches share a prefix. This has been verified to avoid the dropped-match case above — the capture scan then resolves the longer branch first, so the ambiguous prefix stays buffered instead of being flushed as a non-match, and the same three chunks (`"ab"`, `"ca"`, `"bc"`) go on to produce the correct `"abcabc"` match. This depends on scan-resolution order rather than being a documented guarantee, so treat it as a mitigation to test against your own pattern, not a fix.

- **`\k<name>` with no named capturing groups in the pattern** is treated by `regex-partial-match` as an atomic (all-or-nothing) backreference, rather than the [identity escape](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Character_escape) [Annex B](https://tc39.es/ecma262/#sec-regular-expressions-patterns) would otherwise permit — so `"k"` or `"k<"` alone won't register as a valid partial match if this is the pattern's only reference to `\k`. This is a narrow edge case; if the deprecated Annex B identity-escape meaning is actually intended, use `k` instead of `\k`.

### ⚠️ Surrogate pairs separated by chunks

```js
/(?<foo>.)/u;
```

Problem: A chunk ending `\ud83d` and another starting `\ude04` will produce two matches, and thus two calls to any defined replacement function, when applied to a stream of text in a binary encoding, such as UTF-8 etc.

In this example. the named group "foo" will be returned with these individual bytes / code points as matches, rather than the intended single match of `😄`.

> [!TIP]
> It's intended that the transform is used on [well-formed](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/isWellFormed) strings, hence a [`TextDecoderStream`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoderStream) should be used to ensure multi-byte characters do not span chunks.

### ⚠️ End-of-match boundary assertions near a chunk's trailing edge

```js
/foo$/;
/foo\b/;
```

[Boundary Assertion Verification](#addendum-boundary-assertion-verification) resolves `^` (no `m`), `\b`, and `\B` at the *start* of a match — the missing context there is always something already received, just discarded once flushed from the buffer. `$`, and `\b`/`\B` at the *end* of a match are structurally different: the missing context is whatever comes *next*, which — right when the illusion could occur — genuinely hasn't arrived yet. This can't be resolved the same way and remains an open, tracked issue: [#49](https://github.com/TomStrepsil/replace-content-transformer/issues/49).

### ⚠️ Unbounded Quantifiers

```js
/foo.+bar/s;
```

Challenge: Partial regex could match "foo" then greedy quantifier could continue to match indefinitely, thus may buffer entire stream before recognising non-match.

```js
/foo.+/;
```

Challenge: Quantifier will be satisfied at the end of a chunk, which may be arbitrary. e.g. a chunk of "foo ba" will output "foo ba" as a match, without understanding that chunks yet to come may continue to match.

> [!TIP]
> Use non-greedy [quantifiers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Quantifiers) (e.g. `.+?`) to mitigate

Or, more examples:

```js
/[A-Z]+/;
/\p{Uppercase_Letter}+/u;
```

Quantifier will be satisfied eagerly, thus multiple matches will occur. e.g. chunks "please MAT" and "CH this" will produce two matches for the above expression, for "MAT" and "CH".

> [!TIP]
> Wherever possible, deterministic anchor tokens should be used, e.g.
>
> ```js
> /foo[A-Z]+bar/;
> ```
>
> This will ensure matches are only satisfied with a complete expression, properly terminated (with caveats about potential whole-stream buffering, as mentioned above). In this example, `foo` and `bar` anchor the match.

### ✅ Supported Features

- 🔤 [Literal characters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Literal_character) / simple patterns: `/test/`
- 👀 [Lookahead assertions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookahead_assertion) (positive only): `/foo(?=bar)/`
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
- 三 [Multiline](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/multiline): `/^.+?$/ms`
- ⚓ Boundary assertions (⚓ [input](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Input_boundary_assertion), 🆒 [word](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Word_boundary_assertion)): `/\b.+?\b/`, `/^t/m` — correct at the start of a match, including across chunk boundaries (see [caveats](#limitations) for the end-of-match case)
- 🗂️ [Indices](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Groups_and_backreferences#using_groups_and_match_indices)[^2]: `/foo/d`

## Credits

See [credits](https://github.com/TomStrepsil/regex-partial-match/blob/main/README.md#credits) for `regex-partial-match`.

[^1]: After significant performance degradation was observed when attempting [knuth-morris-pratt](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm) for static string partial matching, the project has prioritised innate matching capabilities of the language.

[^2]: See note within [algorithm overview](#algorithm-overview) regarding indices mapping.

[^3]: Each internal `exec()` call runs against a fresh substring starting where the last match ended, but `lastIndex` (set by the previous `g`/`y` call) is left pointing at an offset within the *previous, longer* substring. Reused verbatim as an offset into the new, shorter one, it can point past a real match — which then gets flushed as ordinary non-match content instead of surfacing as a match. `y` compounds this: it also refuses to scan forward from `lastIndex` at all, so a match anywhere but exactly there is missed even on the first call.

[^4]: `(?![\s\S])` asserts "no character exists at the current position" — a claim about content already in hand, decidable immediately from the buffer as it stands, never contingent on anything still to arrive. It isn't looking *ahead* into unseen content at all; it's a boundary check on the known buffer, spelled as a negative lookahead only because that's the native way to express "and nothing follows." It's also confined to the *partial*-match regex, never the original/complete-match regex — its only job is answering "could this still become a match with more input," a permissive buffering decision, not a definitive pass/fail on the match itself. Where it applies, a false positive there just means "keep buffering a little longer," not an incorrectly emitted match. The same reasoning is why `(?=...)` (positive lookahead) is fully supported (see [Supported Features](#-supported-features)) but `(?!...)` isn't: a positive lookahead's own atoms get the same "or buffer more" treatment as the rest of the pattern, so there's no predictive claim being smuggled in.

[^5]: Why not just remember a cheaper classification (e.g. "was the preceding character a word character") instead of re-running a whole regex? Because `RegExpExecArray` never reveals which alternation branch actually matched. For `/^foo|bar/` matching `"bar"` mid-stream, the match has nothing to do with `^` at all — a classification check that reflexively verifies `^` whenever the pattern merely *contains* it would wrongly reject a match that was never gated by it. Re-running the whole pattern via a sticky clone asks "does the *pattern* still match here," not "does *this one assertion* hold," so it never needs to know which branch is responsible.

[^6]: Sticky (`y`), not a plain search: prepending the context character and searching normally would let the pattern match starting *at* that character (consuming it as content) rather than only using it as a lookback. Sticky forces the match to start exactly one position later, so the context character can only ever be inspected, never consumed.

[^7]: Necessary for patterns like `/\bfoo/` matching a haystack containing `"foo"` twice, where only the first occurrence is illusory — abandoning the search after one rejection would silently lose the second, genuinely valid, occurrence. It also means a rejected candidate doesn't necessarily disappear immediately: [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/) has no awareness of this verification and treats `\b` as an always-passable, non-consuming token, so a rejected `\b`-anchored candidate may still be buffered as a live partial-match candidate rather than emitted right away — harmless, since it only costs a little extra buffering and the content still surfaces correctly either way.
