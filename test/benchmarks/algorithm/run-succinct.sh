#!/bin/bash
# Run harness comparison and generate succinct JSON output
# Usage: ./test/benchmarks/algorithm/run-succinct.sh [output-file]

set -euo pipefail

# Default output file if none specified
OUTPUT_FILE="${1:-algorithm/results/comparison-$(date +%Y-%m-%d).json}"

# Ensure results directory exists
mkdir -p "$(dirname "$OUTPUT_FILE")"

TEMP_JSON="$(mktemp -t algorithm-comparison-XXXX.json)"
cleanup() {
  tput cnorm
  rm -f "$TEMP_JSON"
}
trap cleanup EXIT

tput civis
# Run benchmark with progress output (reuses run.sh)
"$(dirname "$0")/run.sh" > "$TEMP_JSON"

echo "📄 Exporting succinct results..." >&2
node --experimental-strip-types algorithm/export-results.ts < "$TEMP_JSON" > "$OUTPUT_FILE"

echo "✅ Benchmark results saved to: $OUTPUT_FILE" >&2
