#!/usr/bin/env bash

set -euo pipefail

# Benchmark Branch/Commit Comparison Contract Runner
#
# Ref A (candidate) always benchmarks the current working tree — benchmark
# scripts, harnesses, and src/ are all taken from the current branch.
#
# Ref B (base) is checked out in an isolated worktree for its src/ only.
# The current branch's test/benchmarks/ and test/harnesses/ are overlaid
# onto that worktree so that benchmark scripts evolve independently of old refs.
#
# Usage:
#   ./test/benchmarks/comparison/compare-branches.sh
#   REF_B=origin/main ./test/benchmarks/comparison/compare-branches.sh
#   REF_B=<commit-hash> ./test/benchmarks/comparison/compare-branches.sh
#
# Optional env vars:
#   REF_A               default: HEAD  (resolved from current working tree; not a worktree)
#   REF_B               default: main  (base ref, checked out as isolated worktree)
#   REF_A_LABEL         default: ref-a
#   REF_B_LABEL         default: ref-b
#   OUTPUT_DIR          default: test/benchmarks/results/branch-comparisons/<timestamp>
#   REQUIRE_CLEAN       default: 1 (fail if current repo is dirty)
#   REQUIRE_ALL_RUNTIMES default: 1 (fail if bun/deno/node unavailable)
#   RUNTIMES            default: node,bun,deno
#   ALGORITHM_SCOPE     default: all (all|public)

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
BENCH_DIR_REL="test/benchmarks"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

REF_A="${REF_A:-HEAD}"
REF_B="${REF_B:-main}"
REF_A_LABEL="${REF_A_LABEL:-ref-a}"
REF_B_LABEL="${REF_B_LABEL:-ref-b}"
REQUIRE_CLEAN="${REQUIRE_CLEAN:-1}"
REQUIRE_ALL_RUNTIMES="${REQUIRE_ALL_RUNTIMES:-1}"
RUNTIMES="${RUNTIMES:-node,bun,deno}"
ALGORITHM_SCOPE="${ALGORITHM_SCOPE:-all}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/test/benchmarks/results/branch-comparisons/$TIMESTAMP}"

mkdir -p "$OUTPUT_DIR/logs"

if [[ "$REQUIRE_CLEAN" == "1" ]] && [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "ERROR: working tree is dirty; set REQUIRE_CLEAN=0 to override" >&2
  exit 1
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd git
require_cmd node
if [[ "$REQUIRE_ALL_RUNTIMES" == "1" ]]; then
  require_cmd bun
  require_cmd deno
fi

# Only the base ref (REF_B) needs a worktree. The candidate (REF_A) always
# runs directly from ROOT_DIR so that uncommitted changes are included and
# the latest benchmark scripts are used.
REF_B_WORKTREE="$(mktemp -d "$ROOT_DIR/.tmp-bench-base-XXXXXX")"
cleanup() {
  git -C "$ROOT_DIR" worktree remove --force "$REF_B_WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$REF_B_WORKTREE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$ROOT_DIR" worktree add --detach "$REF_B_WORKTREE" "$REF_B" >/dev/null

# Overlay the current branch's benchmark scripts onto the base worktree.
# Harnesses and src/ both come from the base ref so they stay API-aligned.
# This means only the comparison logic and runner evolve independently.
echo "Overlaying current benchmark scripts onto base ref worktree"
rm -rf "$REF_B_WORKTREE/test/benchmarks"
cp -r "$ROOT_DIR/test/benchmarks" "$REF_B_WORKTREE/test/"
rm -rf "$REF_B_WORKTREE/test/benchmarks/results"

REF_A_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
REF_B_SHA="$(git -C "$REF_B_WORKTREE" rev-parse --short HEAD)"
REF_A_NAME="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)")"
REF_B_NAME="$(git -C "$REF_B_WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)")"

echo "Candidate (Ref A): $REF_A ($REF_A_SHA) [$REF_A_NAME]"
echo "Base      (Ref B):  $REF_B ($REF_B_SHA) [$REF_B_NAME]"
echo "Output: $OUTPUT_DIR"

validate_json() {
  local file="$1"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));' "$file" >/dev/null
}

run_algorithm_json() {
  local bench_dir="$1"
  local out_json="$2"
  local err_log="$3"

  (
    cd "$bench_dir"
    # Contract requirement: algorithm analysis is captured directly from the benchmark entrypoint.
    if [[ "$ALGORITHM_SCOPE" == "public" ]]; then
      node --experimental-strip-types algorithm/comparison.bench.ts --json --filter '^(Looped IndexOf Anchored|Regex)$' >"$out_json" 2>"$err_log"
    else
      node --experimental-strip-types algorithm/comparison.bench.ts --json >"$out_json" 2>"$err_log"
    fi
  )
  validate_json "$out_json"
}

run_runtime_json() {
  local bench_dir="$1"
  local runtime="$2"
  local out_json="$3"
  local err_log="$4"

  case "$runtime" in
    node)
      (
        cd "$bench_dir"
        node --experimental-strip-types runtime/benchmarks.ts --json >"$out_json" 2>"$err_log"
      )
      ;;
    bun)
      (
        cd "$bench_dir"
        bun run runtime/benchmarks.ts --json >"$out_json" 2>"$err_log"
      )
      ;;
    deno)
      (
        cd "$bench_dir"
        deno run --allow-read --allow-write --allow-env --allow-sys runtime/benchmarks.ts --json >"$out_json" 2>"$err_log"
      )
      ;;
    *)
      echo "ERROR: unknown runtime: $runtime" >&2
      exit 1
      ;;
  esac

  validate_json "$out_json"
}

run_benchmarks() {
  local repo_dir="$1"
  local label="$2"
  local bench_dir="$repo_dir/$BENCH_DIR_REL"

  local alg_json="$OUTPUT_DIR/${label}.algorithm.json"

  echo "Running algorithm JSON benchmark for $label"
  run_algorithm_json "$bench_dir" "$alg_json" "$OUTPUT_DIR/logs/${label}.algorithm.stderr.log"

  local runtime
  IFS=',' read -r -a runtime_list <<< "$RUNTIMES"
  for runtime in "${runtime_list[@]}"; do
    runtime="${runtime// /}"
    [[ -z "$runtime" ]] && continue
    if command -v "$runtime" >/dev/null 2>&1; then
      echo "Running runtime JSON benchmark for $label ($runtime)"
      run_runtime_json "$bench_dir" "$runtime" "$OUTPUT_DIR/${label}.runtime.${runtime}.json" "$OUTPUT_DIR/logs/${label}.runtime.${runtime}.stderr.log"
    elif [[ "$REQUIRE_ALL_RUNTIMES" == "1" ]]; then
      echo "ERROR: runtime '$runtime' required but not available" >&2
      exit 1
    fi
  done
}

run_benchmarks "$ROOT_DIR" "$REF_A_LABEL"
run_benchmarks "$REF_B_WORKTREE" "$REF_B_LABEL"

SUMMARY_JSON="$OUTPUT_DIR/summary.json"
SUMMARY_MD="$OUTPUT_DIR/summary.md"

node --experimental-strip-types \
  "$ROOT_DIR/test/benchmarks/comparison/build-summary.ts" \
  "$OUTPUT_DIR" \
  "$REF_A_LABEL" \
  "$REF_B_LABEL" \
  "$REF_A" \
  "$REF_A_SHA" \
  "$REF_B" \
  "$REF_B_SHA" \
  "$SUMMARY_JSON"

node "$ROOT_DIR/test/benchmarks/comparison/render-summary-markdown.mjs" "$SUMMARY_JSON" "$SUMMARY_MD" >/dev/null

cat > "$OUTPUT_DIR/metadata.json" <<EOF
{
  "contractVersion": "1.0.0",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "refA": {
    "label": "$REF_A_LABEL",
    "ref": "$REF_A",
    "sha": "$REF_A_SHA",
    "resolvedName": "$REF_A_NAME"
  },
  "refB": {
    "label": "$REF_B_LABEL",
    "ref": "$REF_B",
    "sha": "$REF_B_SHA",
    "resolvedName": "$REF_B_NAME"
  },
  "requireClean": $REQUIRE_CLEAN,
  "requireAllRuntimes": $REQUIRE_ALL_RUNTIMES
}
EOF

echo
echo "Comparison complete"
echo "Summary JSON: $SUMMARY_JSON"
echo "Summary MD:   $SUMMARY_MD"
