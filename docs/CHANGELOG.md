# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Removed "CI" badge from [`README.md`](../README.md), this repository does not have post-merge CI on `main`

### Added

- Issue templates
- "CodeQL" badge for [`README.md`](../README.md)

## [0.1.0] - 2025-12-20

### Added

- Core streaming content replacement functionality with boundary-aware pattern matching
- WHATWG Transformer adapters (`ReplaceContentTransformer`, `AsyncReplaceContentTransformer`)
- Node.js Transform stream adapters (`ReplaceContentTransform`, `AsyncReplaceContentTransform`)
- Multiple replacement processors:
  - `StaticReplacementProcessor` - Replace with static strings
  - `FunctionReplacementProcessor` - Replace with function-generated content
  - `IterableFunctionReplacementProcessor` - Replace with iterable/generator functions
  - `AsyncFunctionReplacementProcessor` - Replace with async functions
  - `AsyncIterableFunctionReplacementProcessor` - Replace with async iterables/generators
- Pluggable search strategies (anchor strings, regex)
- Search strategy factory for automatic strategy selection
- Full TypeScript support with type definitions
- Comprehensive test suite
- Performance benchmarks
- Support for Deno, Bun, Node.js, and browser environments
