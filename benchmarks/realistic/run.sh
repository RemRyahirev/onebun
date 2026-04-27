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
  echo -e "${CYAN}[realistic]${NC} $1"
}

wait_for_server() {
  local port=$1
  local max_wait=15
  local waited=0
  while ! curl -so /dev/null "http://127.0.0.1:$port/api/users/1" 2>/dev/null; do
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

run_realistic_bench() {
  local name=$1
  local port=$2
  local start_cmd=$3
  local work_dir=${4:-$REPO_ROOT}
  local db_path=$5

  echo ""
  log "${GREEN}=== $name ===${NC}"

  # Copy fresh database for this framework (include WAL files if present)
  cp "$SCRIPT_DIR/shared/bench.db" "$db_path"
  cp "$SCRIPT_DIR/shared/bench.db-wal" "${db_path}-wal" 2>/dev/null || true
  cp "$SCRIPT_DIR/shared/bench.db-shm" "${db_path}-shm" 2>/dev/null || true

  log "Starting server on port $port..."
  kill_port "$port"

  # Start the server in the background, capture output for diagnostics
  local server_log
  server_log=$(mktemp)
  cd "$work_dir" && eval "BENCH_DB_PATH=$db_path BENCH_PORT=$port $start_cmd" >"$server_log" 2>&1 &
  local server_pid=$!
  cd "$REPO_ROOT"

  if ! wait_for_server "$port"; then
    log "Server failed to start. Output:"
    cat "$server_log" >&2
    rm -f "$server_log"
    kill "$server_pid" 2>/dev/null || true
    kill_port "$port"
    return 1
  fi
  rm -f "$server_log"

  log "Server ready. Running benchmarks..."

  # Benchmark 1: GET /api/posts?page=1&limit=20 (paginated list with cache)
  log "  GET /api/posts?page=1&limit=20"
  # Warm up cache
  curl -sf "http://127.0.0.1:$port/api/posts?page=1&limit=20" > /dev/null
  bombardier \
    -c "$BOMBARDIER_CONNECTIONS" \
    -d "$BOMBARDIER_DURATION" \
    -p r \
    -l \
    "http://127.0.0.1:$port/api/posts?page=1&limit=20" \
    2>&1 | tee "$RESULTS_DIR/realistic-${name}-posts-list.txt"

  # Benchmark 2: GET /api/posts/1 (single with comments + cache)
  log "  GET /api/posts/1"
  curl -sf "http://127.0.0.1:$port/api/posts/1" > /dev/null
  bombardier \
    -c "$BOMBARDIER_CONNECTIONS" \
    -d "$BOMBARDIER_DURATION" \
    -p r \
    -l \
    "http://127.0.0.1:$port/api/posts/1" \
    2>&1 | tee "$RESULTS_DIR/realistic-${name}-post-detail.txt"

  # Benchmark 3: POST /api/posts (validation + write)
  log "  POST /api/posts"
  bombardier \
    -c "$BOMBARDIER_CONNECTIONS" \
    -d "$BOMBARDIER_DURATION" \
    -p r \
    -l \
    -m POST \
    -H "Content-Type: application/json" \
    -b '{"title":"Benchmark Post Title","body":"This is a benchmark post body with enough content to pass validation.","authorId":1}' \
    "http://127.0.0.1:$port/api/posts" \
    2>&1 | tee "$RESULTS_DIR/realistic-${name}-post-create.txt"

  log "Stopping server..."
  kill "$server_pid" 2>/dev/null || true
  kill_port "$port"
  sleep 1

  # Clean up database copy
  rm -f "$db_path" "${db_path}-wal" "${db_path}-shm"
}

# Test that better-sqlite3 native addon actually works (not just require — that
# only loads the JS wrapper; the native binary is loaded on `new Database()`).
test_node_sqlite() {
  local dir=$1
  (cd "$dir" && $NODE_CMD -e "new (require('better-sqlite3'))(':memory:')" 2>/dev/null)
}

# Rebuild better-sqlite3 for the Node version used by benchmarks.
# bun install provides Bun-ABI bindings that Node can't use.
# On NixOS, build tools (make, g++) may be absent from PATH — use nix-shell.
ensure_node_sqlite() {
  local dir=$1
  local label=$2

  if test_node_sqlite "$dir"; then
    return 0
  fi

  log "Rebuilding better-sqlite3 for Node.js ($label)..."

  local rebuild_cmd="$NODE_CMD $(which npm) rebuild better-sqlite3"
  if command -v make >/dev/null 2>&1; then
    (cd "$dir" && eval "$rebuild_cmd") 2>&1 | tail -5
  elif command -v nix-shell >/dev/null 2>&1; then
    log "make not found, using nix-shell for build tools..."
    (cd "$dir" && nix-shell -p gnumake stdenv.cc --run "$rebuild_cmd") 2>&1 | tail -5
  else
    log "ERROR: make not found and nix-shell not available."
    log "Install build tools: make, g++ (e.g. apt install build-essential)"
    return 1
  fi

  if ! test_node_sqlite "$dir"; then
    log "WARNING: better-sqlite3 still not loadable after rebuild ($label)."
    return 1
  fi

  return 0
}

echo "============================================"
echo "  OneBun Realistic Benchmark Suite"
echo "============================================"
echo ""
echo "Settings: ${BOMBARDIER_CONNECTIONS} connections, ${BOMBARDIER_DURATION} duration"
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Bun: $(bun --version)"
echo "Machine: $(uname -m)"
echo "OS: $(uname -s) $(uname -r)"
echo ""
echo "Features: SQLite, Drizzle ORM, Swagger docs"
echo ""

# Seed the database
log "Seeding database..."
bun run "$SCRIPT_DIR/shared/seed.ts"
echo ""

# --- OneBun ---
run_realistic_bench "onebun" 3300 \
  "bun run $SCRIPT_DIR/onebun/src/main.ts" \
  "$REPO_ROOT" \
  "$SCRIPT_DIR/onebun/bench.db"

# --- NestJS + Fastify (Bun runtime) ---
run_realistic_bench "nestjs-fastify-bun" 3301 \
  "bun run $SCRIPT_DIR/nestjs-fastify/src/main.ts" \
  "$SCRIPT_DIR/nestjs-fastify" \
  "$SCRIPT_DIR/nestjs-fastify/bench.db"

# --- NestJS + Fastify (Node.js) ---
log "Building NestJS for Node.js..."
(cd "$SCRIPT_DIR/nestjs-fastify" && bun run build) 2>/dev/null

if ensure_node_sqlite "$SCRIPT_DIR/nestjs-fastify" "nestjs-fastify"; then
  run_realistic_bench "nestjs-fastify-node" 3302 \
    "$NODE_CMD $SCRIPT_DIR/nestjs-fastify/dist/main.js" \
    "$SCRIPT_DIR/nestjs-fastify" \
    "$SCRIPT_DIR/nestjs-fastify/bench.db"
else
  log "Skipping nestjs-fastify-node benchmark."
fi

# --- NestJS + TypeORM (Node.js) — canonical NestJS approach ---
log "Building NestJS TypeORM for Node.js..."
(cd "$SCRIPT_DIR/nestjs-typeorm" && bun run build) 2>/dev/null

if ensure_node_sqlite "$SCRIPT_DIR/nestjs-typeorm" "nestjs-typeorm"; then
  run_realistic_bench "nestjs-typeorm-node" 3303 \
    "$NODE_CMD $SCRIPT_DIR/nestjs-typeorm/dist/main.js" \
    "$SCRIPT_DIR/nestjs-typeorm" \
    "$SCRIPT_DIR/nestjs-typeorm/bench.db"
else
  log "Skipping nestjs-typeorm-node benchmark."
fi

# Clean up seed database
rm -f "$SCRIPT_DIR/shared/bench.db"

echo ""
echo "============================================"
echo "  Realistic Benchmark Complete"
echo "============================================"
