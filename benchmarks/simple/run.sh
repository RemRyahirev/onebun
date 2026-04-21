#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BENCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Use node directly in CI (set up via actions/setup-node), fnm locally
if [ -n "${CI:-}" ]; then
  NODE_CMD="node"
else
  NODE_CMD="fnm exec --using=24 node"
fi

BOMBARDIER_CONNECTIONS=50
BOMBARDIER_DURATION="10s"
RESULTS_DIR="$BENCH_ROOT/results"

mkdir -p "$RESULTS_DIR"

# Colors for output
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() {
  echo -e "${CYAN}[simple]${NC} $1"
}

wait_for_server() {
  local port=$1
  local max_wait=10
  local waited=0
  while ! curl -sf "http://127.0.0.1:$port/" > /dev/null 2>&1; do
    sleep 0.5
    waited=$((waited + 1))
    if [ "$waited" -ge "$((max_wait * 2))" ]; then
      echo "ERROR: Server on port $port did not start within ${max_wait}s"
      return 1
    fi
  done
}

kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  fi
}

run_bench() {
  local name=$1
  local port=$2
  local start_cmd=$3
  local work_dir=${4:-$REPO_ROOT}

  echo ""
  log "${GREEN}=== $name ===${NC}"
  log "Starting server on port $port..."

  kill_port "$port"

  # Start the server in the background
  cd "$work_dir" && eval "$start_cmd" &>/dev/null &
  local server_pid=$!
  cd "$REPO_ROOT"

  if ! wait_for_server "$port"; then
    kill "$server_pid" 2>/dev/null || true
    kill_port "$port"
    return 1
  fi

  log "Server ready. Running bombardier..."

  bombardier \
    -c "$BOMBARDIER_CONNECTIONS" \
    -d "$BOMBARDIER_DURATION" \
    -p r \
    -l \
    "http://127.0.0.1:$port/" \
    2>&1 | tee "$RESULTS_DIR/${name}.txt"

  log "Stopping server..."
  kill "$server_pid" 2>/dev/null || true
  kill_port "$port"
  sleep 1
}

echo "============================================"
echo "  OneBun Simple HTTP Benchmark Suite"
echo "============================================"
echo ""
echo "Settings: ${BOMBARDIER_CONNECTIONS} connections, ${BOMBARDIER_DURATION} duration"
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Bun: $(bun --version)"
echo "Machine: $(uname -m)"
echo "OS: $(uname -s) $(uname -r)"
echo ""

# --- Bun.serve (baseline) ---
run_bench "bun-serve" 3200 \
  "bun run $SCRIPT_DIR/competitors/bun-serve/hello.ts"

# --- OneBun ---
run_bench "onebun" 3100 \
  "bun run $SCRIPT_DIR/onebun-hello.ts"

# --- Hono ---
run_bench "hono" 3201 \
  "bun run $SCRIPT_DIR/competitors/hono-bun/hello.ts" \
  "$SCRIPT_DIR/competitors/hono-bun"

# --- Elysia ---
run_bench "elysia" 3202 \
  "bun run $SCRIPT_DIR/competitors/elysia/hello.ts" \
  "$SCRIPT_DIR/competitors/elysia"

# --- NestJS + Fastify (Bun runtime) ---
run_bench "nestjs-fastify-bun" 3203 \
  "bun run $SCRIPT_DIR/competitors/nestjs-fastify/src/main.ts" \
  "$SCRIPT_DIR/competitors/nestjs-fastify"

# --- NestJS + Fastify (Node.js) ---
# Build first, then run compiled JS with Node 24 LTS
(cd "$SCRIPT_DIR/competitors/nestjs-fastify" && bun run build) 2>/dev/null
run_bench "nestjs-fastify-node" 3204 \
  "BENCH_PORT=3204 $NODE_CMD $SCRIPT_DIR/competitors/nestjs-fastify/dist/main.js" \
  "$SCRIPT_DIR/competitors/nestjs-fastify"

echo ""
echo "============================================"
echo "  Simple Benchmark Complete"
echo "============================================"
