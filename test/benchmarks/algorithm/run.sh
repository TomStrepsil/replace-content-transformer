#!/bin/bash
# Run harness comparison benchmark with progress output (JSON mode only)
# Usage: ./test/benchmarks/algorithm/run.sh

set -euo pipefail

cleanup() {
  tput cnorm >&2
}
trap cleanup EXIT

tput civis >&2
echo "▶️  Running algorithm comparison benchmark (this can take some time)..." >&2

node --experimental-strip-types algorithm/comparison.bench.ts --json &
BENCH_PID=$!

spinner=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
spin_index=0
while kill -s 0 "$BENCH_PID" 2>/dev/null; do
  printf "\r⏳ Collecting samples %s" "${spinner[spin_index]}" >&2
  spin_index=$(((spin_index + 1) % ${#spinner[@]}))
  sleep 0.2
done

wait "$BENCH_PID"
printf "\r✅ Benchmark run complete.%-20s\n" "" >&2
