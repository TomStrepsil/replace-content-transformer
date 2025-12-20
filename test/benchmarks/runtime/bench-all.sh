#!/usr/bin/env bash

# Cross-Runtime Benchmark Runner
# Executes the same benchmark suite across Bun, Deno, and Node.js for comparison

set -e

echo "🎯 Cross-Runtime Benchmark Comparison"
echo "======================================"
echo

# Check which runtimes are available
AVAILABLE_RUNTIMES=()

if command -v bun &> /dev/null; then
    AVAILABLE_RUNTIMES+=("bun")
fi

if command -v deno &> /dev/null; then
    AVAILABLE_RUNTIMES+=("deno")
fi

if command -v node &> /dev/null; then
    AVAILABLE_RUNTIMES+=("node")
fi

if [ ${#AVAILABLE_RUNTIMES[@]} -eq 0 ]; then
    echo "❌ No supported runtimes found (bun, deno, node)"
    exit 1
fi

echo "🚀 Found runtimes: ${AVAILABLE_RUNTIMES[*]}"
echo

# Function to run benchmarks with specific runtime
run_benchmark() {
    local runtime=$1
    echo "📊 Running benchmarks with $runtime"
    echo "----------------------------------------"
    
    case $runtime in
        "bun")
            npm run bench:bun
            ;;
        "deno")
            npm run bench:deno
            ;;
        "node")
            npm run bench:node
            ;;
    esac
    
    echo
    echo "✅ $runtime benchmarks completed"
    echo
}

# Run benchmarks for each available runtime
runtime_count=${#AVAILABLE_RUNTIMES[@]}
current_index=0

for runtime in "${AVAILABLE_RUNTIMES[@]}"; do
    run_benchmark "$runtime"
    
    # Add separator between runtimes (except for the last one)
    current_index=$((current_index + 1))
    if [[ $current_index -lt $runtime_count ]]; then
        echo "========================================"
        echo
    fi
done

echo "🎉 All benchmark runs completed!"
echo
echo "💡 Tips for interpretation:"
echo "   - Higher ops/sec (Hz) = better performance"
echo "   - Compare within categories first"
echo "   - Runtime differences show platform-specific optimizations"
echo "   - Baseline tests should be fastest in each runtime"