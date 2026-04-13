#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAIT_SCRIPT="$SCRIPT_DIR/wait-for-port.ts"

# Use node directly in CI (set up via actions/setup-node), fnm locally
if [ -n "${CI:-}" ]; then
  NODE_CMD="node"
else
  NODE_CMD="fnm exec --using=24 node"
fi

echo "============================================"
echo "  OneBun Startup Time Benchmark"
echo "============================================"
echo ""
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Bun: $(bun --version)"
echo "Machine: $(uname -m)"
echo "OS: $(uname -s) $(uname -r)"
echo ""

RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

# JSON output accumulator
JSON_ENTRIES=()

RUNS=${1:-10}
echo "Runs per framework: $RUNS"
echo "Poll interval: 5ms (HTTP fetch via Bun)"
echo ""

# Measure time from server process start until it accepts HTTP requests.
# Timing is done in bash (date +%s%N); Bun poller just exits on success.
# Usage: measure_startup <name> <command> <port> <runs>
measure_startup() {
  local name="$1"
  local cmd="$2"
  local port="$3"
  local runs="$4"
  local times=()

  echo "=== $name (port $port) ==="

  for ((i = 1; i <= runs; i++)); do
    # Kill anything on the port first
    lsof -ti :"$port" | xargs kill -9 2>/dev/null || true
    sleep 0.05

    # Record start time, then start server
    local start_ns
    start_ns=$(date +%s%N)

    eval "$cmd" &>/dev/null &
    local pid=$!

    # Wait for port (5ms poll interval, 15s timeout)
    if bun run "$WAIT_SCRIPT" "$port" 15000 2>/dev/null; then
      local end_ns
      end_ns=$(date +%s%N)
      local elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
      times+=("$elapsed_ms")
    else
      echo "  Run $i: TIMEOUT"
    fi

    # Kill the server
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    lsof -ti :"$port" | xargs kill -9 2>/dev/null || true
  done

  if [ ${#times[@]} -eq 0 ]; then
    echo "  All runs timed out!"
    echo ""
    return
  fi

  # Calculate stats
  local sum=0
  local min=${times[0]}
  local max=${times[0]}
  for t in "${times[@]}"; do
    sum=$((sum + t))
    ((t < min)) && min=$t
    ((t > max)) && max=$t
  done
  local mean=$((sum / ${#times[@]}))

  # Standard deviation
  local sq_sum=0
  for t in "${times[@]}"; do
    local diff=$((t - mean))
    sq_sum=$((sq_sum + diff * diff))
  done
  local variance=$((sq_sum / ${#times[@]}))
  local stddev=0
  if [ "$variance" -gt 0 ]; then
    stddev=$(echo "scale=1; sqrt($variance)" | bc 2>/dev/null || echo "?")
  fi

  printf "  Time (mean +/- sigma):  %d ms +/- %s ms\n" "$mean" "$stddev"
  printf "  Range (min ... max):    %d ms ... %d ms    (%d runs)\n" "$min" "$max" "${#times[@]}"
  echo ""

  # Append JSON entry
  JSON_ENTRIES+=("{\"name\":\"$name\",\"meanMs\":$mean,\"minMs\":$min,\"maxMs\":$max}")
}

# --- Bun.serve (baseline) ---
measure_startup "Bun.serve (baseline)" \
  "bun run $SCRIPT_DIR/competitors/bun-serve/hello.ts" \
  3200 "$RUNS"

# --- OneBun ---
measure_startup "OneBun" \
  "bun run $SCRIPT_DIR/onebun-hello.ts" \
  3100 "$RUNS"

# --- Hono ---
measure_startup "Hono" \
  "bun run $SCRIPT_DIR/competitors/hono-bun/hello.ts" \
  3201 "$RUNS"

# --- Elysia ---
measure_startup "Elysia" \
  "bun run $SCRIPT_DIR/competitors/elysia/hello.ts" \
  3202 "$RUNS"

# --- NestJS + Fastify (Bun) ---
measure_startup "NestJS + Fastify (Bun)" \
  "cd $SCRIPT_DIR/competitors/nestjs-fastify && bun run src/main.ts" \
  3203 "$RUNS"

# --- NestJS + Fastify (Node 24) ---
# Build first, then measure compiled JS on Node
(cd "$SCRIPT_DIR/competitors/nestjs-fastify" && bun run build) 2>/dev/null
measure_startup "NestJS + Fastify (Node)" \
  "BENCH_PORT=3204 $NODE_CMD $SCRIPT_DIR/competitors/nestjs-fastify/dist/main.js" \
  3204 "$RUNS"

# Write JSON results
{
  echo "["
  local_first=true
  for entry in "${JSON_ENTRIES[@]}"; do
    if [ "$local_first" = true ]; then
      local_first=false
    else
      echo ","
    fi
    echo -n "  $entry"
  done
  echo ""
  echo "]"
} > "$RESULTS_DIR/startup.json"
echo "Startup results saved to $RESULTS_DIR/startup.json"

echo "============================================"
echo "  Startup Benchmark Complete"
echo "============================================"
