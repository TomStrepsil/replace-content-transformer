# Search Strategies

This directory contains search strategies for finding and matching patterns in streaming content. Each strategy handles patterns that may span chunk boundaries.

These strategies have been chosen from an array of alternatives based on performance (see [benchmarking](#benchmark-strategies)). The "string anchor" is most performant (marginally), so should be preferred unless more complex matching is required.

## 🪝 String Anchor (N-Token Sequential Matching)

**[looped-indexOf-anchored](./looped-indexOf-anchored/README.md)** - Exported as `StringAnchorSearchStrategy`

Single or Multiple-token sequential matching using smart buffering (only when the tail of a chunk might be the prefix of a match). Uses native `indexOf` for fast exact string matching. Ideal for matching patterns like `{replace me}`, `[START]...[END]` or more complex multi-delimiter sequences.

- **Algorithm**: Selective buffering with sequential token matching
- **Performance**: O(n+m), very fast due to native `indexOf` optimizations, with no content searched twice while a match spans chunks
- **Use Case**: Single or Sequential multi-delimiter patterns in streaming content
- **Exported As**: `StringAnchorSearchStrategy`

## ⚖️ Balanced Pair (Nesting-Aware Matching)

**[balanced-pair](./balanced-pair/README.md)** - Nesting-aware delimiter matching strategy implementation

Matches opening/closing delimiters where nesting is meaningful: the match only completes once every inner opening has a corresponding closing. Each opening awaiting its closing is kept on a stack, and the match completes when the outermost one is closed.

- **Algorithm**: A stack of open delimiters, popped by each closing delimiter
- **Performance**: O(n+m), each delimiter found once and pushed or popped once
- **Use Case**: Balanced/nested structures — parentheses, braces, custom multi-character delimiters
- **Exported As**: `BalancedPairSearchStrategy`

## 🧠 Regex

**[regex](./regex/README.md)** - Pattern matching using regular expressions

[Regular expression](https://en.wikipedia.org/wiki/Regular_expression) matching with partial match detection for smart buffering. Handles complex patterns, wildcards, and character classes that span chunk boundaries.

- **Algorithm**: Partial regex matching with buffering of prefix matches
- **Performance**: O(n×p), variable depending on pattern complexity
- **Use Case**: Complex patterns, wildcards, character classes
- **Exports**: `RegexSearchStrategy`, and `LeanRegexSearchStrategy` for a smaller bundle (see [Lean Bundles](./regex/README.md#lean-bundles))

Every strategy holds back no more than `maxBufferLength` code units (65,536 by default) awaiting a decision. See [Buffering and the guard](../../README.md#buffering-and-the-guard).

## 📊 Benchmark Strategies

Additional search strategy implementations exist for performance comparison and algorithmic research. These are **not part of the public API** but are maintained in the [`benchmarking`](./benchmarking/README.md) subdirectory for optimization insights and algorithm comparison.
