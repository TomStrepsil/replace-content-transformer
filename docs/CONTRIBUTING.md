# Contributing to replace-content-transformer

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to maintain a welcoming environment for all contributors. See [Code of Conduct](./CODE_OF_CONDUCT.md)

## Getting Started

### Prerequisites

- Node.js >= 24
- git

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/replace-content-transformer.git
   cd replace-content-transformer
   ```
3. **Add the upstream repository** as a remote:
   ```bash
   git remote add upstream https://github.com/TomStrepsil/replace-content-transformer.git
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```

### Scripts

| Script                     | Does                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `npm test`                 | Runs the tests                                                         |
| `npm run test:watch`       | Runs the tests in watch mode                                           |
| `npm run test:ci`          | Runs the tests with coverage, as CI does                               |
| `npm run lint`             | Lints the code                                                         |
| `npm run build`            | Builds `lib/`                                                          |
| `npm run bench`            | Benchmarks the string anchor strategy on Node                          |
| `npm run bench:runtimes`   | The same, on each of Node, Deno and Bun that is installed              |
| `npm run bench:algorithms` | Compares algorithms, most of them unexported references                |

See [Benchmarks](../test/benchmarks/README.md) for the rest.

## Before You Start

### Check for Existing Issues

Before starting work, please:

1. **Search [existing issues](https://github.com/TomStrepsil/replace-content-transformer/issues)** to see if your bug or feature has already been reported
2. **Check [open pull requests](https://github.com/TomStrepsil/replace-content-transformer/pulls)** to avoid duplicate work
3. If no issue exists, **create a new issue** describing:
   - What you want to add/fix
   - Why it's needed
   - How you plan to implement it

Wait for feedback before starting significant work to ensure your contribution aligns with the project's goals.

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b issue-number_description-of-contribution
# or
git checkout -b no-issue_description-of-contribution
```

e.g.

- `11_add-unicode-normalization`
- `22_handle-empty-patterns`
- `34_improve-readme-examples`
- `no-issue_some-minor-thing`

### 2. Make Your Changes

- Write clear, concise code
- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Document your changes

- If the published package changes (`lib/`, `README.md`, `LICENSE` or the consumer-facing fields of `package.json`), add an entry to the `[Unreleased]` section in `docs/CHANGELOG.md`, following [keepachangelog](https://keepachangelog.com/) style. Changes to tests, benchmarks, CI or other docs don't need one; CI checks which applies

### 4. Run Tests

Ensure all tests pass:

```bash
npm test
```

### 5. Run Linter

Check code quality:

```bash
npm run lint
```

### 6. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git add .
git commit -m "add support for unicode normalization"
```

### 7. Keep Your Branch Updated

Regularly sync with upstream:

```bash
git fetch upstream
git merge upstream/main
```

### 8. Push to Your Fork

```bash
git push origin issue-number_your-feature-name
```

## 📬 Submitting a Pull Request

1. **Push your branch** to your fork on GitHub
2. **Open a pull request** from your branch to `TomStrepsil/regex-partial-match:main`
3. **Fill out the PR template** with:
   - Issue number prefix (or `[NO ISSUE]`) in the title
   - Description of changes
   - Related issue number(s)
   - Testing performed
   - Breaking changes (if any)
4. **Wait for review** - maintainers will review your PR and may request changes

### Pull Request Guidelines

- **One concern per PR** - Keep PRs focused on a single feature or fix
  - ["scout rule"](https://biratkirat.medium.com/step-8-the-boy-scout-rule-robert-c-martin-uncle-bob-9ac839778385) fixes / refactors are acceptable, but should be fully described in the PR summary
- **Include tests** - All new functionality should have test coverage
- **Update documentation** - Add or update docs for changed functionality
- **Keep it small** - Smaller PRs are easier to review and merge
- **Be responsive** - Address review feedback promptly

## 🧪 Testing Guidelines

Tests use [Vitest](https://vitest.dev/) with globals enabled. CI runs the suite on Node, Bun and Deno, so a test must pass on all three. Where a runtime genuinely differs (e.g. a regex feature Bun doesn't support yet), gate it with `test.skipIf(...)` and explain why in the test name or the condition's variable name. `npm run test:ci` runs the suite with coverage, as CI does.

### Where tests live

- **Unit tests** sit next to the code they cover as `*.test.ts` (e.g. `src/adapters/web/transformer.test.ts`). They isolate one unit and mock its collaborators.
- **Integration tests** sit alongside as `*.integration.test.ts`. They wire real components together (adapter + engine + search strategy) and drive them through a real `TransformStream` or Node `Transform`. Name the `describe` after the composition under test, e.g. `"ReplaceContentTransformer + SerialTransformEngine + StringAnchorSearchStrategy"`.
- **Shared helpers** live in [`test/`](../test/README.md). Check there before writing a new mock or collector.

### Test descriptions document behaviour

Production code doesn't carry explanatory comments (see [Code Style](#-code-style)). Good naming carries most of the explanation; whatever naming can't express lives in the test that pins the behaviour down. When you add a branch, guard or edge case, write a test whose description states the behaviour and why it matters, for example:

- `"resets balancedBuffer after yielding a match so subsequent matches start fresh"`
- `"flushes buffered partial content before passthrough when abort is set between chunks"`
- `"preserves non-match tail content from a chunk that ended mid-nesting"`

If you find yourself writing a comment to explain some code, first try to make the code explain itself. Pull the expression into a variable, constant or helper whose name says what it means, e.g. `const isMidMatch = state.currentNeedleIndex > 0` rather than a bare comparison with a comment beside it. Only when the logic still isn't self-documenting, typically because the *why* depends on stream behaviour the code can't show, put that extra detail in the test description. When the code changes, the test fails, so the explanation can't silently go stale the way a comment can.

Group related cases under nested `describe` blocks named for the behaviour area (`"nested matches"`, `"cross-chunk processing"`, `"stream offset tracking"`). Use `it.each` / `describe.each` when the same assertion runs over a table of inputs.

### Chunk boundaries

Correct behaviour shouldn't depend on where the stream happens to be split. Any new search strategy, or any fix to how one buffers across chunks, should come with a test asserting the same matches at every split of the input.

### Further reading

- [`test/README.md`](../test/README.md): shared mocks, collectors and chunk-split helpers
- [`test/benchmarks/harnesses/README.md`](../test/benchmarks/harnesses/README.md): running a strategy through the shared validation and benchmark scenarios
- [`test/benchmarks/references/README.md`](../test/benchmarks/references/README.md#-testing): how much testing the reference strategies and engine shapes need

## 🧩 Search strategies and engines

The `SearchStrategy` and `TransformEngine` interfaces are exported, so a strategy or engine can be written outside this package. To propose one for the package, or a change to an existing one, [raise an issue](#check-for-existing-issues) first.

### Search strategy contract

A strategy implements `SearchStrategy`, reporting what it finds to a `MatchSink`:

```typescript
type StreamIndices = [startIndex: number, endIndex: number];

interface MatchSink<TMatch = string> {
  reportText(content: string): void;
  reportMatch(content: TMatch, streamIndices: StreamIndices): boolean;
}

interface SearchStrategy<TState, TMatch = string> {
  createState(): TState;
  processChunk(
    haystack: string,
    state: TState,
    sink: MatchSink<TMatch>
  ): undefined;
  flush(state: TState): string;
  settle?(state: TState, sink: MatchSink<TMatch>): undefined;
  matchToString(match: TMatch): string;
}
```

A strategy must be **stateless**: everything that changes as a stream is searched, such as a partial match held across chunks or the position in the stream, belongs in its `TState`, never on the strategy itself. The engine owns that state, one per stream, and passes it to every call. So any construction cost, such as compiling a pattern, is paid once, and one strategy instance can serve many streams, even at the same time. The strategy instance holds only its configuration (needles, pattern, options), fixed at construction.

- **`createState`** returns a fresh state for a new stream. The engine calls it once, when it is constructed.
- **`processChunk`** reports the chunk in stream order: literal content through `reportText`, each match through `reportMatch`, with `streamIndices` as absolute offsets into the engine's input. It returns `undefined` rather than `void`, so a strategy still written as a generator is a type error rather than one that silently reports nothing. A sink rather than a generator lets the engine stop or pause at any match, and lets one strategy wrap another's sink, as `BalancedPairSearchStrategy` does around an anchor strategy. It is 1.03–1.7x faster across the streaming scenarios of the algorithm benchmarks, about 1.2x in a typical one (see [Engine shapes](../test/benchmarks/references/README.md#-engine-shapes)).
- **`reportMatch`** returns whether to carry on. On `false`, the strategy returns at once, leaving everything after that match in the state. The engine then either calls `flush` to emit it verbatim, as once `stopReplacingSignal` aborts, or resumes the search by calling `processChunk` with `""` (or `settle` again), but only once `processChunk` (or `settle`) has returned, since the state is complete only then. `SerialTransformEngine` pauses like this at a match whose replacement it awaits, and `LookaheadTransformEngine` at one that fills its queue, so a strategy can be paused at every match. Join what the state holds to a chunk only when neither is empty: on Bun, a string joined with `""` is copied when it is next searched, which costs the rest of the chunk at every match ([WebKit bug 332729](https://bugs.webkit.org/show_bug.cgi?id=332729)). The built-in strategies leave the rest in the state from a `finally` block, which also keeps the state intact if a sink call throws.
- **`flush`** returns anything still held, as raw text without searching it, and resets the state for reuse. The engine calls it at the end of the stream when the strategy has no `settle`, and once `stopReplacingSignal` has aborted.
- **`settle`**, optional, is called in place of `flush` at the end of the stream, unless `stopReplacingSignal` has aborted, to decide what is still held. It reports to the sink as `processChunk` does, so a decision deferred at the final chunk boundary can still be a match: `RegexSearchStrategy` re-scans its buffer with the original pattern. It also resets the state.
- **`matchToString`** converts a match back to its raw text, for a match emitted verbatim.

`TMatch` lets a strategy report richer matches than a string, as `RegexSearchStrategy` does with a [`StreamRegexMatch`](./search-strategies.md#regex-matches).

An engine drives its strategy along these lines:

```typescript
let stoppedAt: string | undefined;
const sink: MatchSink<TMatch> = {
  reportText: (content) => output.enqueue(content),
  reportMatch: (content, streamIndices) => {
    if (stopReplacingSignal?.aborted) {
      stoppedAt = this.searchStrategy.matchToString(content);
      return false;
    }
    output.enqueue(/* some replacement form (static, functional, iterator, async...) */);
    return true;
  }
};
write(chunk: string) {
  this.searchStrategy.processChunk(chunk, this.searchState, sink);
  if (stoppedAt !== undefined) {
    /* the match verbatim, then the rest of the chunk and anything held */
    output.enqueue(stoppedAt + this.searchStrategy.flush(this.searchState));
    stoppedAt = undefined;
  }
}
end() {
  if (this.searchStrategy.settle) {
    this.searchStrategy.settle(this.searchState, sink);
  } else {
    const held = this.searchStrategy.flush(this.searchState);
    if (held) output.enqueue(held);
  }
}
```

### Engine contract

An engine implements `TransformEngine`:

```typescript
interface TransformEngine {
  start(sink: EngineSink): void;
  write(chunk: string): void | Promise<void>;
  end(): void | Promise<void>;
  cancel?(): void;
}
```

`write()` and `end()` return `undefined` when the call completed synchronously, or a `Promise` the adapter waits for before its next call.

The `EngineSink` receives the output as strings. A `ByteEngineSink`, which sets `acceptsBytes: true`, as `ReplaceContentTransformer` and `ReplaceContentTransform` do, also receives the UTF-8 bytes a replacement produces asynchronously, in order with the strings around them, without their being decoded. Each chunk of bytes is valid UTF-8 that ends at a character boundary, and may be a view of the replacement's own buffer, so a sink that keeps one past `enqueue` must copy it.

A sink with `ready()` gives backpressure within a chunk: `ready()` returns `undefined` while downstream can take more output, and otherwise a `Promise` that resolves once it can. Engines call it once they have enqueued the output they hold, and call no further replacement until a `Promise` it returned resolves or they are cancelled. `room()`, optional beside it, gives how many more code units downstream can take, so `SerialTransformEngine` can hold that much synchronous output before enqueuing it, rather than enqueuing before every replacement. A sink whose downstream counts chunks sets `roomCountsChunks`, so the engine reads `room()` again after each chunk it enqueues. `ReplaceContentStream`, `ReplaceContentTextStream` and `ReplaceContentTransform` supply `ready()` and `room()`, and set `roomCountsChunks` when their readable side counts chunks.

See the [search strategy contract](#search-strategy-contract) for how an engine drives its strategy, and [Engines](./engines.md#driving-an-engine) for why only an adapter should drive an engine.

## 🎨 Code Style

- TypeScript with strict mode
- Follow existing patterns in the codebase
- Use descriptive variable names
- Prefer code over comments
  - use named constants and helpers, and put the reasoning in test descriptions (see [Testing Guidelines](#-testing-guidelines))
- Run `npm run lint` to check style

## 📚 Documentation

When adding new features:

1. **Update the docs**: examples in [`recipes.md`](./recipes.md), API detail in the other `docs/` pages, and the [README](../README.md) only where its overview tables change
2. **Update TypeScript types** for public APIs
3. **Include JSDoc comments** for exported functions

## 🆘 Getting Help

- **Questions?** Open a [discussion](https://github.com/TomStrepsil/regex-partial-match/discussions) or issue
- **Stuck?** Comment on your PR or issue for help
- **Found a bug?** Open an issue with reproduction steps

## 🏆 Recognition

All contributors will be recognized in the project. Your contributions are valued and appreciated!

## 📜 License

By contributing, you agree that your contributions will be licensed under the ISC License.
