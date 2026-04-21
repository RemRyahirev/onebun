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
  echo -e "${CYAN}[realistic-pg]${NC} $1"
}

wait_for_server() {
  local port=$1
  local max_wait=20
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

run_pg_bench() {
  local name=$1
  local port=$2
  local start_cmd=$3
  local work_dir=${4:-$REPO_ROOT}

  echo ""
  log "${GREEN}=== $name ===${NC}"
  log "Starting server on port $port..."

  kill_port "$port"

  # Start the server in the background, capture output for diagnostics
  local server_log
  server_log=$(mktemp)
  cd "$work_dir" && eval "DATABASE_URL=$DATABASE_URL BENCH_PORT=$port DB_HOST=$PG_HOST DB_PORT=$PG_PORT DB_USER=$PG_USER DB_PASSWORD=$PG_PASSWORD DB_NAME=$PG_DB $start_cmd" >"$server_log" 2>&1 &
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

  # Warm up cache
  curl -sf "http://127.0.0.1:$port/api/posts?page=1&limit=20" > /dev/null 2>&1 || true
  curl -sf "http://127.0.0.1:$port/api/posts/1" > /dev/null 2>&1 || true

  # Benchmark 1: GET /api/posts?page=1&limit=20 (paginated list with cache)
  log "  GET /api/posts?page=1&limit=20"
  bombardier \
    -c "$BOMBARDIER_CONNECTIONS" \
    -d "$BOMBARDIER_DURATION" \
    -p r \
    -l \
    "http://127.0.0.1:$port/api/posts?page=1&limit=20" \
    2>&1 | tee "$RESULTS_DIR/realistic-pg-${name}-posts-list.txt"

  # Benchmark 2: GET /api/posts/1 (single with comments + cache)
  log "  GET /api/posts/1"
  bombardier \
    -c "$BOMBARDIER_CONNECTIONS" \
    -d "$BOMBARDIER_DURATION" \
    -p r \
    -l \
    "http://127.0.0.1:$port/api/posts/1" \
    2>&1 | tee "$RESULTS_DIR/realistic-pg-${name}-post-detail.txt"

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
    2>&1 | tee "$RESULTS_DIR/realistic-pg-${name}-post-create.txt"

  log "Stopping server..."
  kill "$server_pid" 2>/dev/null || true
  kill_port "$port"
  sleep 1
}

echo "============================================"
echo "  OneBun Realistic PostgreSQL Benchmark"
echo "============================================"
echo ""
echo "Settings: ${BOMBARDIER_CONNECTIONS} connections, ${BOMBARDIER_DURATION} duration"
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Bun: $(bun --version)"
echo "Machine: $(uname -m)"
echo "OS: $(uname -s) $(uname -r)"
echo ""
echo "Features: PostgreSQL, in-memory cache, validation, Swagger docs"
echo ""

# --- PostgreSQL setup ---
PG_CONTAINER="bench-postgres"
PG_PORT=5499
PG_USER="bench"
PG_PASSWORD="bench"
PG_DB="bench"
PG_HOST="127.0.0.1"
DATABASE_URL="postgres://$PG_USER:$PG_PASSWORD@$PG_HOST:$PG_PORT/$PG_DB"

# In CI, PostgreSQL is provided as a service container (already running on port 5499).
# Locally, we start our own Docker container.
if [ -n "${CI:-}" ]; then
  log "Using CI PostgreSQL service on port $PG_PORT..."
else
  log "Starting PostgreSQL container..."
  docker rm -f "$PG_CONTAINER" 2>/dev/null || true
  docker run -d \
    --name "$PG_CONTAINER" \
    -e POSTGRES_USER="$PG_USER" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB="$PG_DB" \
    -p "$PG_PORT:5432" \
    --tmpfs /var/lib/postgresql/data \
    postgres:16-alpine \
    -c shared_buffers=256MB \
    -c max_connections=200 \
    -c synchronous_commit=off \
    > /dev/null

  # Wait for PostgreSQL to be ready
  log "Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

log "Seeding database..."
DATABASE_URL="$DATABASE_URL" bun run "$SCRIPT_DIR/shared/seed.ts"
echo ""

# --- OneBun ---
run_pg_bench "onebun" 3300 \
  "bun run $SCRIPT_DIR/onebun/src/main.ts" \
  "$REPO_ROOT"

# --- OneBun (full observability: logs + metrics + traces) ---
run_pg_bench "onebun-full" 3304 \
  "bun run $SCRIPT_DIR/onebun-full/src/main.ts" \
  "$REPO_ROOT"

# --- NestJS + Fastify + Drizzle (Bun runtime) ---
run_pg_bench "nestjs-fastify-bun" 3301 \
  "bun run $SCRIPT_DIR/nestjs-fastify/src/main.ts" \
  "$SCRIPT_DIR/nestjs-fastify"

# --- NestJS + Fastify + Drizzle (Node.js) ---
log "Building NestJS Drizzle for Node.js..."
(cd "$SCRIPT_DIR/nestjs-fastify" && bun run build) 2>/dev/null
run_pg_bench "nestjs-fastify-node" 3302 \
  "$NODE_CMD $SCRIPT_DIR/nestjs-fastify/dist/main.js" \
  "$SCRIPT_DIR/nestjs-fastify"

# --- NestJS + TypeORM (Node.js) ---
log "Building NestJS TypeORM for Node.js..."
(cd "$SCRIPT_DIR/nestjs-typeorm" && bun run build) 2>/dev/null
run_pg_bench "nestjs-typeorm-node" 3303 \
  "$NODE_CMD $SCRIPT_DIR/nestjs-typeorm/dist/main.js" \
  "$SCRIPT_DIR/nestjs-typeorm"

# --- Cleanup ---
if [ -z "${CI:-}" ]; then
  log "Stopping PostgreSQL container..."
  docker rm -f "$PG_CONTAINER" > /dev/null 2>&1 || true
fi

echo ""
echo "============================================"
echo "  Realistic PostgreSQL Benchmark Complete"
echo "============================================"
