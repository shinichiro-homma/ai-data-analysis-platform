#!/bin/bash
# Shared helper functions for rebuild.sh, switch-env.sh, clean-rebuild.sh
# Usage: source "$(dirname "$0")/lib/common.sh"

# Valid environment names
VALID_ENVS=("sample" "production")

# Validate environment name against VALID_ENVS
# Args: $1 = env name to validate
# Returns: 0 if valid, 1 if invalid (with error message to stderr)
validate_env() {
  local env_name="$1"
  local v
  for v in "${VALID_ENVS[@]}"; do
    if [[ "$env_name" == "$v" ]]; then
      return 0
    fi
  done
  echo "Error: invalid environment '${env_name}' (available: ${VALID_ENVS[*]})" >&2
  return 1
}

# Read DATA_ENV from .env file
# Returns: DATA_ENV value (defaults to "sample" if not found)
read_data_env() {
  local data_env
  data_env=$(grep -E '^DATA_ENV=' .env 2>/dev/null | cut -d= -f2- || echo "sample")
  echo "${data_env:-sample}"
}

# Update DATA_ENV in .env file
# Args: $1 = new env value
set_data_env_in_dotenv() {
  local new_env="$1"
  if grep -q "^DATA_ENV=" .env 2>/dev/null; then
    # Use python3 for cross-platform compatibility (macOS/Linux sed -i differs)
    uv run python -c "
import re, pathlib
p = pathlib.Path('.env')
content = p.read_text()
content = re.sub(r'^DATA_ENV=.*', 'DATA_ENV=${new_env}', content, flags=re.MULTILINE)
p.write_text(content)
"
  else
    echo "DATA_ENV=${new_env}" >> .env
  fi
}

# Prune Docker garbage (dangling images, build cache, orphaned volumes)
prune_docker_garbage() {
  echo ""
  echo "--- Pruning Docker garbage ---"
  echo "  Removing dangling images..."
  docker image prune -f 2>/dev/null || true
  echo "  Removing build cache..."
  docker builder prune -f 2>/dev/null || true
  echo "  Removing orphaned volumes..."
  docker volume prune -f 2>/dev/null || true
  echo "  Done."
}

# Wait for PostgreSQL process to be ready (pg_isready)
# Args: $1 = POSTGRES_USER (default: jupyter), $2 = timeout seconds (default: 30)
wait_for_postgres_ready() {
  local pg_user="${1:-jupyter}"
  local timeout="${2:-30}"
  echo "  Waiting for PostgreSQL process..."
  for i in $(seq 1 "$timeout"); do
    if docker compose exec -T postgres pg_isready -U "$pg_user" > /dev/null 2>&1; then
      echo "  PostgreSQL process is ready."
      return 0
    fi
    if [[ $i -eq $timeout ]]; then
      echo "  ERROR: PostgreSQL failed to start within ${timeout} seconds" >&2
      return 1
    fi
    sleep 1
  done
}

# Wait for DB initialization (table creation) to complete
# Args: $1 = POSTGRES_USER (default: jupyter), $2 = POSTGRES_DB (default: analysis_db),
#        $3 = timeout seconds (default: 60)
wait_for_db_init() {
  local pg_user="${1:-jupyter}"
  local pg_db="${2:-analysis_db}"
  local timeout="${3:-60}"
  echo "  Waiting for DB initialization (timeout: ${timeout}s)..."
  for i in $(seq 1 "$timeout"); do
    local table_count
    table_count=$(docker compose exec -T postgres psql -U "$pg_user" -d "$pg_db" -t -A \
      -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null || echo "0")
    table_count=$(echo "$table_count" | tr -d '[:space:]')

    if [[ "$table_count" -gt 0 ]] 2>/dev/null; then
      echo "  DB initialization complete (${table_count} tables found)."
      return 0
    fi
    if [[ $i -eq $timeout ]]; then
      echo "  ERROR: DB initialization did not complete within ${timeout} seconds" >&2
      return 1
    fi
    sleep 1
  done
}

# Wait for an HTTP service to become healthy
# Args: $1 = URL, $2 = service name, $3 = timeout seconds (default: 30)
wait_for_http_service() {
  local url="$1"
  local service_name="$2"
  local timeout="${3:-30}"
  echo "  Waiting for ${service_name}..."
  for i in $(seq 1 "$timeout"); do
    if curl -sf --connect-timeout 3 --max-time 5 "$url" > /dev/null 2>&1; then
      echo "  ${service_name} is ready."
      return 0
    fi
    if [[ $i -eq $timeout ]]; then
      echo "  ERROR: ${service_name} failed to start within ${timeout} seconds" >&2
      return 1
    fi
    sleep 1
  done
}

# Read POSTGRES_* from .env and run load-data.py with PG* env vars
# Args: $1 = env name (default: $DATA_ENV)
# Requires: .env file in current directory
run_load_data() {
  local data_env="${1:?env argument required}"
  local load_script="postgres/init/${data_env}/load-data.py"

  if [[ ! -f "$load_script" ]]; then
    echo "  ERROR: $load_script not found. Run: scripts/generate-init-scripts.sh $data_env" >&2
    return 1
  fi

  local pg_user pg_password pg_db
  pg_user=$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || echo "jupyter")
  pg_password=$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | cut -d= -f2- || echo "")
  pg_db=$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || echo "analysis_db")

  # Wait for host TCP connection to be ready (container exec may be ready before host TCP)
  echo "  Waiting for PostgreSQL TCP connection from host..."
  local max_retries=30
  for i in $(seq 1 "$max_retries"); do
    if uv run python -c "
import psycopg2, sys
try:
    conn = psycopg2.connect(host='localhost', port=5432, user='${pg_user:-jupyter}', password='${pg_password}', dbname='${pg_db:-analysis_db}', connect_timeout=3)
    conn.close()
except Exception:
    sys.exit(1)
" 2>/dev/null; then
      echo "  PostgreSQL TCP connection is ready."
      break
    fi
    if [[ $i -eq $max_retries ]]; then
      echo "  ERROR: PostgreSQL TCP connection not ready within ${max_retries} seconds" >&2
      return 1
    fi
    sleep 1
  done

  echo "  Loading data from host via $load_script ..."
  PGHOST=localhost PGPORT=5432 \
    PGUSER="${pg_user:-jupyter}" \
    PGPASSWORD="${pg_password}" \
    PGDATABASE="${pg_db:-analysis_db}" \
    uv run python "$load_script" || {
    echo "  ERROR: Data load failed" >&2
    return 1
  }
  echo "  Data loaded successfully."
}

# Get Docker Compose project name
get_compose_project_name() {
  docker compose config --format json 2>/dev/null \
    | uv run python -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null \
    || basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g'
}

# Get environment-specific postgres volume name
# Note: docker-compose.yml uses `name:` property so no project prefix
get_postgres_volume_name() {
  local env="${1:-sample}"
  echo "postgres_data_${env}"
}

# Check if environment-specific postgres volume exists
postgres_volume_exists() {
  local env="${1:-sample}"
  local vol_name
  vol_name=$(get_postgres_volume_name "$env")
  docker volume inspect "$vol_name" >/dev/null 2>&1
}

# Remove environment-specific postgres volume
remove_postgres_volume() {
  local env="${1:-sample}"
  local vol_name
  vol_name=$(get_postgres_volume_name "$env")
  if docker volume inspect "$vol_name" >/dev/null 2>&1; then
    echo "  Removing volume: $vol_name"
    docker volume rm "$vol_name"
  else
    echo "  Volume not found: $vol_name (will be created on startup)"
  fi
}

# Find newest file timestamp (epoch seconds) in a directory matching glob patterns
# Args: $1 = directory, $2... = glob patterns (e.g. "*.ts" "*.py")
newest_file_epoch() {
  local dir="$1"
  shift
  local glob_patterns=("$@")

  local find_args=()
  local first=true
  for pat in "${glob_patterns[@]}"; do
    if $first; then
      find_args+=(-name "$pat")
      first=false
    else
      find_args+=(-o -name "$pat")
    fi
  done

  local exclude_args=(
    -not -path '*/node_modules/*'
    -not -path '*/.mypy_cache/*'
    -not -path '*/__pycache__/*'
    -not -path '*/.pytest_cache/*'
    -not -path '*.egg-info/*'
  )

  local epoch
  epoch=$(find "$dir" \( "${find_args[@]}" \) \
    "${exclude_args[@]}" \
    -exec stat -f '%m' {} + 2>/dev/null | sort -rn | head -1) || \
  epoch=$(find "$dir" \( "${find_args[@]}" \) \
    "${exclude_args[@]}" \
    -printf '%T@\n' 2>/dev/null | sort -rn | head -1) || true

  echo "${epoch%.*}"
}

# Get container creation epoch (by service name via docker compose)
# Args: $1 = service name
container_epoch() {
  local service="$1"
  local container_id
  container_id=$(docker compose ps -q "$service" 2>/dev/null | head -1) || true

  if [[ -z "$container_id" ]]; then
    echo ""
    return
  fi

  local container_time
  container_time=$(docker inspect --format='{{.Created}}' "$container_id" 2>/dev/null) || true

  if [[ -z "$container_time" ]]; then
    echo ""
    return
  fi

  local time_str
  time_str=$(echo "$container_time" | cut -d'.' -f1)
  # Docker returns UTC time — append Z to ensure correct timezone parsing
  local epoch
  epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$time_str" "+%s" 2>/dev/null) || \
  epoch=$(TZ=UTC date -d "$time_str" "+%s" 2>/dev/null) || true

  if [[ -z "$epoch" ]]; then
    echo "WARNING: failed to parse container time for $service: $container_time" >&2
  fi
  echo "$epoch"
}

# Check if a Docker Compose service is running
# Args: $1 = service name
# Returns: 0 (running) / 1 (not running)
# Uses `docker compose ps -q` + `docker inspect` to avoid SIGPIPE from `grep -q` + pipefail
is_service_running() {
  local service="$1"
  local container_id
  container_id=$(docker compose ps -q "$service" 2>/dev/null | head -1) || true
  [[ -n "$container_id" ]] && docker inspect --format='{{.State.Running}}' "$container_id" 2>/dev/null | grep -q "true"
}

# Remove legacy postgres_data volume (pre-28.1, with project name prefix)
remove_legacy_postgres_volume() {
  local project_name
  project_name=$(get_compose_project_name)
  local legacy_vol="${project_name}_postgres_data"
  if docker volume inspect "$legacy_vol" >/dev/null 2>&1; then
    echo "  Removing legacy volume: $legacy_vol"
    docker volume rm "$legacy_vol" 2>/dev/null || true
  fi
}
