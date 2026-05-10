#!/bin/bash
# Run the concurrency strategy benchmark suite (virtual clock via Vitest fake timers).
#
# Examples:
#   ./lookahead-engine/run.sh                          # 30 blocks, all scenarios
#   ./lookahead-engine/run.sh --scenario Uniform       # single scenario
#   ./lookahead-engine/run.sh --concurrency 8          # override concurrency dial
#   ./lookahead-engine/run.sh --timeline               # add Gantt-chart timeline per scenario

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

CONCURRENCY=""
SEED=""
SCENARIO=""
TIMELINE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --seed)        SEED="$2";        shift 2 ;;
    --scenario)    SCENARIO="$2";    shift 2 ;;
    --timeline)    TIMELINE="1";     shift   ;;
    *) shift ;;
  esac
done

ENV_ARGS=("BENCH_MODE=1")
[[ -n "$CONCURRENCY" ]] && ENV_ARGS+=("BENCH_CONCURRENCY=$CONCURRENCY")
[[ -n "$TIMELINE" ]]    && ENV_ARGS+=("BENCH_TIMELINE=1")
[[ -n "$SEED" ]]        && ENV_ARGS+=("BENCH_SEED=$SEED")
[[ -n "$SCENARIO" ]]    && ENV_ARGS+=("BENCH_SCENARIO=$SCENARIO")

env "${ENV_ARGS[@]}" npx vitest run lookahead-engine/run.bench.ts --reporter=verbose
