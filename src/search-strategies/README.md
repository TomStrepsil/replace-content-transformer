# Search Strategies

This directory contains search strategies for finding and matching patterns in streaming content. Each strategy handles patterns that may span chunk boundaries.

These strategies have been chosen from an array of alternatives based on performance (see [benchmarking](#benchmark-strategies)). The "string anchor" should be preferred, since slightly more performant, unless more complex matching is required.

## 🪝 String Anchor (N-Token Sequential Matching)

**[looped-indexOf-anchored](./looped-indexOf-anchored/README.md)** - Exported as `StringAnchorSearchStrategy`

Single or Multiple-token sequential matching using smart buffering (only when the tail of a chunk might be the prefix of a match). Uses native `indexOf` for fast exact string matching. Ideal for matching patterns like `{replace me}`, `[START]...[END]` or more complex multi-delimiter sequences.

- **Algorithm**: Selective buffering with sequential token matching
- **Performance**: O(n+m), very fast due to native `indexOf` optimizations
- **Use Case**: Single or Sequential multi-delimiter patterns in streaming content
- **Exported As**: `StringAnchorSearchStrategy`

## 🧠 Regex

**[regex](./regex/README.md)** - Pattern matching using regular expressions

[Regular expression](https://en.wikipedia.org/wiki/Regular_expression) matching with partial match detection for smart buffering. Handles complex patterns, wildcards, and character classes that span chunk boundaries.

- **Algorithm**: Partial regex matching with buffering of prefix matches
- **Performance**: O(n×p), variable depending on pattern complexity
- **Use Case**: Complex patterns, wildcards, character classes
- **Exports**: `RegexSearchStrategy`

## 📊 Benchmark Strategies

Additional search strategy implementations exist for performance comparison and algorithmic research. These are **not part of the public API** but are maintained in the [`benchmarking`](./benchmarking/README.md) subdirectory for optimization insights and algorithm comparison.
