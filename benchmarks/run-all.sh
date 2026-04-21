#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RESULTS_DIR="$SCRIPT_DIR/results"
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

echo "============================================"
echo "  OneBun Full Benchmark Suite"
echo "============================================"
echo ""

# Run simple HTTP benchmarks
"$SCRIPT_DIR/simple/run.sh"

# Run realistic benchmarks (SQLite)
"$SCRIPT_DIR/realistic/run.sh"

# Run realistic PostgreSQL benchmarks (requires Docker)
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  "$SCRIPT_DIR/realistic-pg/run.sh"
else
  echo ""
  echo "[SKIP] Realistic PostgreSQL benchmarks — Docker not available"
  echo ""
fi

# Run startup benchmarks
"$SCRIPT_DIR/startup.sh"

echo ""
echo "============================================"
echo "  All Benchmark Suites Complete"
echo "============================================"
echo ""
echo "Raw results saved in: $RESULTS_DIR/"
