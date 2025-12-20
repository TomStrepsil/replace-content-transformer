# Contributing to replace-content-transformer

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to maintain a welcoming environment for all contributors. See [Code of Conduct](./CODE_OF_CONDUCT.md)

## Getting Started

### Prerequisites

- Node.js >= 23
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
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

Use descriptive branch names:

- `feature/add-unicode-normalization`
- `fix/handle-empty-patterns`
- `docs/improve-readme-examples`

### 2. Make Your Changes

- Write clear, concise code
- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Document your changes

- Add an entry to the `[Unreleased]` section in `docs/CHANGELOG.md`

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
git push origin feature/your-feature-name
```

## Submitting a Pull Request

1. **Push your branch** to your fork on GitHub
2. **Open a pull request** from your branch to `TomStrepsil/regex-partial-match:main`
3. **Fill out the PR template** with:
   - Description of changes
   - Related issue number(s)
   - Testing performed
   - Breaking changes (if any)
4. **Wait for review** - maintainers will review your PR and may request changes

### Pull Request Guidelines

- **One concern per PR** - Keep PRs focused on a single feature or fix
- **Include tests** - All new functionality should have test coverage
- **Update documentation** - Add or update docs for changed functionality
- **Keep it small** - Smaller PRs are easier to review and merge
- **Be responsive** - Address review feedback promptly

## Code Style

- TypeScript with strict mode
- Follow existing patterns in the codebase
- Use descriptive variable names
- Add comments for complex logic
- Run `npm run lint` to check style

## Documentation

When adding new features:

1. **Update README.md** with examples and API documentation
2. **Update TypeScript types** for public APIs
3. **Include JSDoc comments** for exported functions

## Getting Help

- **Questions?** Open a [discussion](https://github.com/TomStrepsil/regex-partial-match/discussions) or issue
- **Stuck?** Comment on your PR or issue for help
- **Found a bug?** Open an issue with reproduction steps

## Recognition

All contributors will be recognized in the project. Your contributions are valued and appreciated!

## License

By contributing, you agree that your contributions will be licensed under the ISC License.
