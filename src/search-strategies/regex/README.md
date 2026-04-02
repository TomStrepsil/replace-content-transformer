# Regex Search Strategy

A generator-based strategy that matches patterns using **regular expressions** with intelligent partial match detection to handle patterns spanning chunk boundaries.

## Algorithm Overview

This strategy uses JavaScript's [`RegExp.prototype.exec`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec) for pattern matching, combined with a partial matching transformation to detect when a chunk might end mid-pattern. Unlike simple string matching, regex patterns can be unbounded (e.g., wildcards), requiring sophisticated logic to determine when to buffer content.

Unlike C/C++ (via [PCRE/PCRE2](https://www.pcre.org/original/doc/html/pcrepartial.html), [RE2](https://github.com/google/re2?tab=readme-ov-file#matching-interface), [Boost.Regex](https://www.boost.org/doc/libs/1_34_1/libs/regex/doc/partial_matches.html)), Python ([via third party regex module](https://pypi.org/project/regex/#:~:text=Added%20partial%20matches)) or Java (via [`hitEnd`](https://docs.oracle.com/javase/8/docs/api/java/util/regex/Matcher.html#hitEnd--)), Javascript has no canonical/innate partial-matching for regular expressions.

This library uses a sibling package ([`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match/)) to generate a "partial match" regex on construction, based on the supplied pattern, allowing detection of potential incomplete matches at chunk boundaries, thus allowing buffering only where a continued match is possible.

This has been chosen for simplicity and performance, with libraries such as [`incr-regex-package`](https://www.npmjs.com/package/incr-regex-package), [`dfa`](https://github.com/foliojs/dfa), [`refa`](https://github.com/RunDevelopment/refa), which might provide partial-match capability (and perhaps resolve some of the lookaround [limitations](#limitations)), not evaluated [^1].

To enable optimistic/early yielding, certain regular expression features are unsupported. e.g. [lookbehinds](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion), negative [lookaheads](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookahead_assertion) and [backreferences](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Backreference). See [Limitations](#limitations) for full explanation.

> [!WARNING]
> The strategy yields an object containing `{ content: RegExpExecArray }` for matches (rather than `{ content: string }`), where the `RegExpExecArray` is the result of calling `RegExp.prototype.exec`. This provides access to capture groups via `match.content[1]`, `match.content[2]`, etc., and named groups via `match.content.groups`. The array also includes [`index`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec#index) and [`input`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec#input) properties, which make little sense in a streaming scenario and should be disregarded.

> [!NOTE]
> Where the `d` flag is provided, indices are mapped to be offsets into the stream as a whole.  The indices on the match will duplicate the `streamIndices` passed to the replacement function.  However, the `groups` property on indices is also updated, which may prove more useful.

## How It Works

### Dual Regex Approach

The strategy maintains two regex patterns:

```typescript
import createPartialMatchRegex from "regex-partial-match";

class RegexSearchStrategy {
  private readonly completeMatchRegex: RegExp; // Original pattern
  private readonly partialMatchRegex: RegExp; // Transformed for partial detection

  constructor(needle: RegExp) {
    this.completeMatchRegex = needle;
    this.partialMatchRegex = createPartialMatchRegex(needle); // Transform!
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

## Partial Match Transformation

See documentation of `regex-partial-match` for explanation of [how it works](https://github.com/TomStrepsil/regex-partial-match/tree/main?tab=readme-ov-file#how-it-works).

**Example transformation:**

```
Original pattern:    /PLACEHOLDER/
Complete regex:      /PLACEHOLDER/
Partial regex:       /(?:P(?:L(?:A(?:C(?:E(?:H(?:O(?:L(?:D(?:E(?:R|$)|$)|$)|$)|$)|$)|$)|$)|$)|$)|$)/

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
- **Flush:** Return buffered content

## Limitations

Due to the streaming nature of the algorithm, or due to the implementation of [`regex-partial-match`](https://github.com/TomStrepsil/regex-partial-match), certain regex features are problematic:

### ❌ Backreferences

```js
/(.+?) \1/;
```

Problem: Input of "foo foo", split across chunks, will not match. The partial-match algorithm does not support matching against capture groups.

> [!WARNING]
> The input validation will reject expressions that contain the [named backreference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Named_backreference) signifier `\k`, despite this also being [a deprecated syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Deprecated_and_obsolete_features#regexp:~:text=The%20sequence%20%5Ck%20within%20a%20regex%20that%20doesn%27t%20have%20any%20named%20capturing%20groups%20is%20treated%20as%20an%20identity%20escape.) for an [identity escape](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Character_escape), in non-unicode-aware regular expressions. This simplifies the validation. Update `\k` in unicode-unaware expressions to use `k` instead, to avoid such patterns being rejected.

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

### ⚠️ Surrogate pairs separated by chunks

```js
/(?<foo>.)/u;
```

Problem: A chunk ending `\ud83d` and another starting `\ude04` will produce two matches, and thus two calls to any defined replacement function, when applied to a stream of text in a binary encoding, such as UTF-8 etc.

In this example. the named group "foo" will be returned with these individual bytes / code points as matches, rather than the intended single match of `😄`.

> [!TIP]
> It's intended that the transform is used on [well-formed](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/isWellFormed) strings, hence a [`TextDecoderStream`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoderStream) should be used to ensure multi-byte characters do not span chunks.

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
- 🌐 [Unicode character class escapes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape): `/\p{Script_Extensions=Latin}+/gu`
- 🧮 [Unicode sets (`v` flag)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/unicodeSets): (`/[\p{Lowercase}&&\p{Script=Greek}]/v`)
- 🔀 [Disjunctions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Disjunction): `/cat|dog/`
- 👥 [Non-capturing groups](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Non-capturing_group): `/(?:hello)+/`
- 👪 Capturing groups (🫥 [unnamed](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Capturing_group) and 📛 [named](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Named_capturing_group)): `/(hello|hi) there (?<name>.+?)/`
- 三 [Multiline](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/multiline): `/^.+?$/ms`
- 🚧 Boundary assertions (⚓ [input](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Input_boundary_assertion), 🆒 [word](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Word_boundary_assertion)): `/\b.+?\b/`, `/^t/m`
- 🗂️ [Indices](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Groups_and_backreferences#using_groups_and_match_indices)[^2]: `/foo/d`

## Credits

See [credits](https://github.com/TomStrepsil/regex-partial-match/blob/main/README.md#credits) for `regex-partial-match`.

[^1]: After significant performance degradation was observed when attempting [knuth-morris-pratt](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm) for static string partial matching, the project has prioritised innate matching capabilities of the language.

[^2]: See note within [algorithm overview](#algorithm-overview) regarding indices mapping.