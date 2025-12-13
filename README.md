# replace-content-transfomer

A WHATWG Transformer / Node stream.Transform for replacing content

## Installation

```bash
npm install replace-content-transfomer
```

## Usage

```typescript
import { ReplaceContentTransformer } from 'replace-content-transfomer';

// Replace with string
const transformer = new ReplaceContentTransformer('hello', 'goodbye');
console.log(transformer.transform('hello world')); // "goodbye world"

// Replace with regex
const regexTransformer = new ReplaceContentTransformer(/\d+/g, 'X');
console.log(regexTransformer.transform('test 123')); // "test X"
```

## Development

### Prerequisites

- Node.js 20 or higher
- npm

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Watch mode for tests

```bash
npm run test:watch
```

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Add an entry to the `[Unreleased]` section in CHANGELOG.md
4. Submit a Pull Request
5. Select the appropriate semver checkbox in the PR template

## Release Process

Releases are automated based on semver selections in merged PRs:

1. Go to the repository's **Releases** page
2. Click "**Draft a new release**"
3. Create a draft release (the tag name and version will be auto-determined)
4. Click "**Publish release**"
5. The release workflow will automatically:
   - Analyze all merged PRs since the last release
   - Determine the version bump based on the highest semver selection (MAJOR > MINOR > PATCH)
   - Calculate the next version number using `npm version`
   - Update package.json version
   - Update CHANGELOG.md with the release date
   - Commit the changes
   - Create a git tag with the calculated version
   - Update the GitHub release with the correct version and details

**Important**: Ensure all PRs have a semver checkbox selected (PATCH/MINOR/MAJOR) in their description before merging.

## Branch Protection

The `main` branch is protected and requires:
- Pull requests for all changes
- Status checks to pass (build and tests)
- CHANGELOG.md entries for all PRs

See [.github/BRANCH_PROTECTION.md](.github/BRANCH_PROTECTION.md) for setup instructions.

## License

ISC
