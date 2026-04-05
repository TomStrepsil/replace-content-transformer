#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

MODE=full BENCH_OUTPUT="${BENCH_OUTPUT:-$ROOT_DIR/test/benchmarks/pr-comparison.full.md}" \
  bash "$ROOT_DIR/test/benchmarks/comparison/create-pr-summary.sh"
