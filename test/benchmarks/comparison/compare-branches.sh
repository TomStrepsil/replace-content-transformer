#!/usr/bin/env bash

set -euo pipefail

# Benchmark Branch/Commit Comparison Contract Runner
#
# Ref A (candidate) is inferred automatically:
# - If REF_A is omitted (or resolves to current HEAD), benchmark current working tree.
# - If REF_A resolves to a different commit/ref, benchmark an isolated ref worktree.
#
# Ref B (base) is checked out in an isolated worktree for its src/ only.
# The current branch's test/benchmarks/ is overlaid onto that worktree so that
# benchmark scripts evolve independently of old refs.
#
# Usage:
#   ./test/benchmarks/comparison/compare-branches.sh
#   REF_B=origin/main ./test/benchmarks/comparison/compare-branches.sh
#   REF_B=<commit-hash> ./test/benchmarks/comparison/compare-branches.sh
#
# Optional env vars:
#   REF_A               default: HEAD
#                       omitted -> working tree; supplied non-HEAD ref -> isolated worktree
#   REF_B               default: origin/main  (base ref, checked out as isolated worktree)
#   REF_A_LABEL         default: ref-a
#   REF_B_LABEL         default: ref-b
#   OUTPUT_DIR          default: test/benchmarks/results/branch-comparisons/<timestamp>
#   REQUIRE_CLEAN       default: 1 (fail if current repo is dirty)
#   REQUIRE_ALL_RUNTIMES default: 1 (fail if bun/deno/node unavailable)
#   RUNTIMES            default: node,bun,deno
#   ALGORITHM_SCOPE     default: public (all|public)

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
BENCH_DIR_REL="test/benchmarks"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

REF_A_WAS_SET=0
if [[ -n "${REF_A+x}" ]]; then
  REF_A_WAS_SET=1
fi

REF_A="${REF_A:-HEAD}"
REF_B="${REF_B:-origin/main}"
REF_A_LABEL="${REF_A_LABEL:-ref-a}"
REF_B_LABEL="${REF_B_LABEL:-ref-b}"
REQUIRE_CLEAN="${REQUIRE_CLEAN:-1}"
REQUIRE_ALL_RUNTIMES="${REQUIRE_ALL_RUNTIMES:-1}"
RUNTIMES="${RUNTIMES:-node,bun,deno}"
ALGORITHM_SCOPE="${ALGORITHM_SCOPE:-public}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/test/benchmarks/results/branch-comparisons/$TIMESTAMP}"

if [[ "$ALGORITHM_SCOPE" != "all" && "$ALGORITHM_SCOPE" != "public" ]]; then
  echo "ERROR: invalid ALGORITHM_SCOPE '$ALGORITHM_SCOPE' (expected: all|public)" >&2
  exit 1
fi

if [[ "$REF_A_WAS_SET" == "0" ]]; then
  REF_A_SOURCE_RESOLVED="working-tree"
else
  HEAD_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  REF_A_RESOLVED_SHA="$(git -C "$ROOT_DIR" rev-parse "$REF_A" 2>/dev/null || true)"
  if [[ -z "$REF_A_RESOLVED_SHA" ]]; then
    echo "ERROR: unable to resolve REF_A '$REF_A'" >&2
    exit 1
  fi
  if [[ "$REF_A_RESOLVED_SHA" == "$HEAD_SHA" ]]; then
    REF_A_SOURCE_RESOLVED="working-tree"
  else
    REF_A_SOURCE_RESOLVED="ref"
  fi
fi

mkdir -p "$OUTPUT_DIR/logs"

if [[ "$REQUIRE_CLEAN" == "1" ]] && [[ "$REF_A_SOURCE_RESOLVED" == "working-tree" ]] && [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
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

REF_A_WORKTREE=""
REF_B_WORKTREE="$(mktemp -d "$ROOT_DIR/.tmp-bench-base-XXXXXX")"
cleanup() {
  if [[ -n "$REF_A_WORKTREE" ]]; then
    git -C "$ROOT_DIR" worktree remove --force "$REF_A_WORKTREE" >/dev/null 2>&1 || true
    rm -rf "$REF_A_WORKTREE" >/dev/null 2>&1 || true
  fi
  git -C "$ROOT_DIR" worktree remove --force "$REF_B_WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$REF_B_WORKTREE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ "$REF_A_SOURCE_RESOLVED" == "ref" ]]; then
  REF_A_WORKTREE="$(mktemp -d "$ROOT_DIR/.tmp-bench-candidate-XXXXXX")"
  git -C "$ROOT_DIR" worktree add --detach "$REF_A_WORKTREE" "$REF_A" >/dev/null
fi

git -C "$ROOT_DIR" worktree add --detach "$REF_B_WORKTREE" "$REF_B" >/dev/null

overlay_benchmark_scripts() {
  local target_repo="$1"
  rm -rf "$target_repo/test/benchmarks"
  cp -r "$ROOT_DIR/test/benchmarks" "$target_repo/test/"
  rm -rf "$target_repo/test/benchmarks/results"
}

if [[ "$REF_A_SOURCE_RESOLVED" == "ref" ]]; then
  echo "Overlaying current benchmark scripts onto candidate ref worktree"
  overlay_benchmark_scripts "$REF_A_WORKTREE"
fi

echo "Overlaying current benchmark scripts onto base ref worktree"
overlay_benchmark_scripts "$REF_B_WORKTREE"

if [[ "$REF_A_SOURCE_RESOLVED" == "ref" ]]; then
  CANDIDATE_REPO_DIR="$REF_A_WORKTREE"
  REF_A_SHA="$(git -C "$REF_A_WORKTREE" rev-parse --short HEAD)"
  REF_A_NAME="$(git -C "$REF_A_WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)")"
else
  CANDIDATE_REPO_DIR="$ROOT_DIR"
  REF_A_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
  REF_A_NAME="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)")"
fi

REF_B_SHA="$(git -C "$REF_B_WORKTREE" rev-parse --short HEAD)"
REF_B_NAME="$(git -C "$REF_B_WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)")"

echo "Candidate (Ref A): $REF_A ($REF_A_SHA) [$REF_A_NAME] [source=$REF_A_SOURCE_RESOLVED]"
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
    ALGORITHM_SCOPE="$ALGORITHM_SCOPE" node --experimental-strip-types algorithm/comparison.bench.ts --json >"$out_json" 2>"$err_log"
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

run_benchmarks "$CANDIDATE_REPO_DIR" "$REF_A_LABEL"
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
  "requireAllRuntimes": $REQUIRE_ALL_RUNTIMES,
  "refASource": "$REF_A_SOURCE_RESOLVED"
}
EOF

echo
echo "Comparison complete"
echo "Summary JSON: $SUMMARY_JSON"
echo "Summary MD:   $SUMMARY_MD"
