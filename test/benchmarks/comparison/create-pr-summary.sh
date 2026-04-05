#!/usr/bin/env bash

set -euo pipefail

# Creates a PR benchmark comparison:
#   1. Benchmarks candidate (HEAD / current working tree) vs base (origin/main by default)
#   2. Generates a single markdown file with performance delta tables
#   3. Cleans up all intermediate files — only the markdown is kept
#
# The current branch's benchmark scripts are always used. Only src/ comes from the base ref.
#
# Usage:
#   bash ./test/benchmarks/comparison/create-pr-summary.sh
#
# Optional env vars:
#   REF_B             Base ref to compare against (default: origin/main)
#   MODE              fast|full (default: fast)
#   BENCH_OUTPUT      Output markdown path (default: test/benchmarks/pr-comparison.md)
#   REQUIRE_ALL_RUNTIMES  Fail if any runtime unavailable (default: 0)

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

REF_B="${REF_B:-origin/main}"
MODE="${MODE:-fast}"
REQUIRE_ALL_RUNTIMES="${REQUIRE_ALL_RUNTIMES:-0}"
BENCH_OUTPUT="${BENCH_OUTPUT:-$ROOT_DIR/test/benchmarks/pr-comparison.md}"

USER_RUNTIMES="${RUNTIMES:-}"
USER_ALGORITHM_SCOPE="${ALGORITHM_SCOPE:-}"

case "$MODE" in
  fast)
    RUNTIMES="${USER_RUNTIMES:-node}"
    ALGORITHM_SCOPE="${USER_ALGORITHM_SCOPE:-public}"
    REQUIRE_ALL_RUNTIMES="${REQUIRE_ALL_RUNTIMES:-0}"
    ;;
  full)
    RUNTIMES="${USER_RUNTIMES:-node,bun,deno}"
    ALGORITHM_SCOPE="${USER_ALGORITHM_SCOPE:-all}"
    ;;
  *)
    echo "ERROR: MODE must be 'fast' or 'full'" >&2
    exit 1
    ;;
esac

TEMP_DIR="$(mktemp -d "$ROOT_DIR/.tmp-bench-pr-XXXXXX")"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

(
  cd "$ROOT_DIR"
  REF_B="$REF_B" \
  RUNTIMES="$RUNTIMES" \
  ALGORITHM_SCOPE="$ALGORITHM_SCOPE" \
  OUTPUT_DIR="$TEMP_DIR" \
  REQUIRE_CLEAN=0 \
  REQUIRE_ALL_RUNTIMES="$REQUIRE_ALL_RUNTIMES" \
  bash ./test/benchmarks/comparison/compare-branches.sh
)

cp "$TEMP_DIR/summary.md" "$BENCH_OUTPUT"

echo ""
echo "Benchmark comparison written to: $BENCH_OUTPUT"
echo "Mode: $MODE | Runtimes: $RUNTIMES | Algorithm scope: $ALGORITHM_SCOPE"
