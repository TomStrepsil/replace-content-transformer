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

- Add an entry to the `[Unreleased]` section in `docs/CHANGELOG.md`, following [keepachangelog](https://keepachangelog.com/) style

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

- **Unit tests** sit next to the code they cover as `*.test.ts` (e.g. `src/adapters/web/sync-transformer.test.ts`). They isolate one unit and mock its collaborators.
- **Integration tests** sit alongside as `*.integration.test.ts`. They wire real components together (adapter + engine + search strategy) and drive them through a real `TransformStream` or Node `Transform`. Name the `describe` after the composition under test, e.g. `"ReplaceContentTransformer + SyncReplacementTransformEngine + StringAnchorSearchStrategy"`.
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
- [`test/harnesses/README.md`](../test/harnesses/README.md): running a strategy through the shared validation and benchmark scenarios
- [`src/search-strategies/benchmarking/README.md`](../src/search-strategies/benchmarking/README.md#-testing): how much testing the reference strategies need

## 🎨 Code Style

- TypeScript with strict mode
- Follow existing patterns in the codebase
- Use descriptive variable names
- Prefer code over comments
  - use named constants and helpers, and put the reasoning in test descriptions (see [Testing Guidelines](#-testing-guidelines))
- Run `npm run lint` to check style

## 📚 Documentation

When adding new features:

1. **Update README.md** with examples and API documentation
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
