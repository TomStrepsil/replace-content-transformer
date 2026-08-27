#!/bin/bash
# Run the regex content-shape benchmarks.
#
# Examples:
#   ./regex-shapes/run.sh              # timing run (mitata)
#   ./regex-shapes/run.sh --report     # buffering + fidelity, no timing
#   ./regex-shapes/run.sh --json       # timing run as JSON, for diffing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [[ "${1:-}" == "--report" ]]; then
  shift
  exec node --import tsx regex-shapes/report.ts "$@"
fi

exec node --import tsx regex-shapes/run.bench.ts "$@"
