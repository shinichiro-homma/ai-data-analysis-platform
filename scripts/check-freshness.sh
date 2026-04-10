#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/lib/common.sh

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Docker 環境の鮮度をチェックします。
ソースコードの最終更新時刻と Docker イメージ/ビルド成果物のビルド時刻を比較し、
環境が最新かどうかを検証します。

OPTIONS:
  --strict    古い場合は exit 1 で終了
  --rebuild   古い場合は自動リビルド
  -h, --help  このヘルプを表示

チェック対象:
  - jupyter-server:       Docker イメージ vs jupyter-server/ ソース
  - document-server:      Docker イメージ vs document-server/ ソース
  - document-server (data): YAML データ vs document-server コンテナ起動時刻
  - jupyter-mcp:          ビルド成果物 (dist/) vs jupyter-mcp/src/ ソース
  - document-mcp:         ビルド成果物 (dist/) vs document-mcp/src/ ソース
  - postgres (init):      カタログ YAML vs 生成済み init スクリプト
  - postgres (data):      init スクリプト + CSV/Parquet vs postgres コンテナ
EOF
}

STRICT=false
REBUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)   STRICT=true; shift ;;
    --rebuild)  REBUILD=true; shift ;;
    -h|--help)  usage; exit 0 ;;
    -*)         echo "Error: unknown option $1" >&2; usage; exit 1 ;;
    *)          echo "Error: unexpected argument $1" >&2; usage; exit 1 ;;
  esac
done

STALE=()

# Read DATA_ENV once (used by check_postgres_init, check_postgres_data, and rebuild)
CURRENT_DATA_ENV=$(read_data_env)

# Validate DATA_ENV to prevent path traversal
if ! validate_env "$CURRENT_DATA_ENV"; then
  exit 1
fi

# Check if Docker is available
if ! command -v docker >/dev/null 2>&1; then
  echo "WARNING: docker command not found. Skipping freshness check."
  exit 0
fi

# ============================================================
# Helper functions
# ============================================================

# newest_file_epoch, container_epoch, and is_service_running are provided by scripts/lib/common.sh

# ============================================================
# Check functions
# ============================================================

# Check Docker service freshness
check_docker_service() {
  local service="$1"
  local source_dir="$2"

  local container_ts
  container_ts=$(container_epoch "$service")

  if [[ -z "$container_ts" ]]; then
    echo "  $service: SKIP (container not found or cannot parse time)"
    return
  fi

  local source_epoch
  source_epoch=$(newest_file_epoch "$source_dir" "*.ts" "*.py" "*.json" "Dockerfile")

  if [[ -z "$source_epoch" ]]; then
    echo "  $service: SKIP (no source files found)"
    return
  fi

  if [[ "$source_epoch" -gt "$container_ts" ]]; then
    echo "  $service: STALE (source newer than container)"
    STALE+=("$service")
  else
    echo "  $service: OK"
  fi
}

# Check MCP server build freshness
check_mcp_build() {
  local component="$1"
  local src_dir="$component/src"
  local dist_dir="$component/dist"

  if [[ ! -d "$dist_dir" ]]; then
    echo "  $component: STALE (dist/ not found, run npm run build)"
    STALE+=("$component")
    return
  fi

  local source_epoch
  source_epoch=$(newest_file_epoch "$src_dir" "*.ts")

  if [[ -z "$source_epoch" ]]; then
    echo "  $component: SKIP (no source files)"
    return
  fi

  local dist_epoch
  dist_epoch=$(newest_file_epoch "$dist_dir" "*.js")

  if [[ -z "$dist_epoch" ]]; then
    echo "  $component: STALE (no dist files)"
    STALE+=("$component")
    return
  fi

  if [[ "$source_epoch" -gt "$dist_epoch" ]]; then
    echo "  $component: STALE (source newer than dist/)"
    STALE+=("$component")
  else
    echo "  $component: OK"
  fi
}

# Check postgres freshness — Layer 1: catalog YAML → init scripts
check_postgres_init() {
  local catalog_dir="document-server/data/${CURRENT_DATA_ENV}/catalog"
  local init_dir="postgres/init/${CURRENT_DATA_ENV}"

  if [[ ! -d "$catalog_dir" ]]; then
    echo "  postgres (init): SKIP (catalog dir not found: $catalog_dir)"
    return
  fi

  if [[ ! -d "$init_dir" ]]; then
    echo "  postgres (init): STALE (init dir not found: $init_dir, run: scripts/generate-init-scripts.sh $CURRENT_DATA_ENV)"
    STALE+=("postgres-init")
    return
  fi

  local newest_yaml_epoch
  newest_yaml_epoch=$(newest_file_epoch "$catalog_dir" "*.yaml" "*.yml")

  local newest_init_epoch
  newest_init_epoch=$(newest_file_epoch "$init_dir" "*.sql" "*.sh" "*.py")

  if [[ -z "$newest_yaml_epoch" ]]; then
    echo "  postgres (init): SKIP (no catalog YAML files)"
  elif [[ -z "$newest_init_epoch" ]]; then
    echo "  postgres (init): STALE (no init scripts, run: scripts/generate-init-scripts.sh $CURRENT_DATA_ENV)"
    STALE+=("postgres-init")
  elif [[ "$newest_yaml_epoch" -gt "$newest_init_epoch" ]]; then
    echo "  postgres (init): STALE (catalog YAML newer than init scripts, run: scripts/generate-init-scripts.sh $CURRENT_DATA_ENV)"
    STALE+=("postgres-init")
  else
    echo "  postgres (init): OK"
  fi
}

# Check postgres freshness — Layer 2: init scripts + CSV → postgres container
check_postgres_data() {
  local init_dir="postgres/init/${CURRENT_DATA_ENV}"
  local csv_dir="postgres/data/${CURRENT_DATA_ENV}"

  if ! is_service_running "postgres"; then
    echo "  postgres (data): SKIP (not running)"
    return
  fi

  local pg_container_ts
  pg_container_ts=$(container_epoch "postgres")

  if [[ -z "$pg_container_ts" ]]; then
    echo "  postgres (data): SKIP (cannot get container time)"
    return
  fi

  local stale_reason=""

  # Check init scripts vs container
  if [[ -d "$init_dir" ]]; then
    local init_epoch
    init_epoch=$(newest_file_epoch "$init_dir" "*.sql" "*.sh" "*.py")
    if [[ -n "$init_epoch" ]] && [[ "$init_epoch" -gt "$pg_container_ts" ]]; then
      stale_reason="init scripts newer than container"
    fi
  fi

  # Check CSV files vs container
  if [[ -z "$stale_reason" ]] && [[ -d "$csv_dir" ]]; then
    local newest_data_epoch
    newest_data_epoch=$(newest_file_epoch "$csv_dir" "*.csv" "*.parquet")
    if [[ -n "$newest_data_epoch" ]] && [[ "$newest_data_epoch" -gt "$pg_container_ts" ]]; then
      stale_reason="data files newer than container"
    fi
  fi

  if [[ -n "$stale_reason" ]]; then
    echo "  postgres (data): STALE ($stale_reason, run: scripts/switch-env.sh $CURRENT_DATA_ENV)"
    STALE+=("postgres-data")
  else
    echo "  postgres (data): OK"
  fi
}

# Check document-server YAML data freshness
# Uses /health endpoint's last_reload timestamp (set on startup and after POST /admin/reload)
check_document_data() {
  local data_dir="document-server/data/${CURRENT_DATA_ENV}"

  if [[ ! -d "$data_dir" ]]; then
    echo "  document-server (data): SKIP (data dir not found)"
    return
  fi

  # Get last_reload timestamp from /health endpoint
  local last_reload
  last_reload=$(curl -sf http://localhost:3002/health 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data['catalog']['last_reload'])
except Exception:
    pass
" 2>/dev/null)

  if [[ -z "$last_reload" ]]; then
    # Fallback to container start time if health endpoint is unavailable
    local container_ts
    container_ts=$(container_epoch "document-server")
    if [[ -z "$container_ts" ]]; then
      echo "  document-server (data): SKIP (container not found)"
      return
    fi
    local reload_epoch="$container_ts"
  else
    # Convert ISO timestamp to epoch
    local reload_epoch
    reload_epoch=$(python3 -c "
from datetime import datetime, timezone
ts = '$last_reload'
# Handle both offset-aware and naive ISO formats
if ts.endswith('+00:00') or ts.endswith('Z'):
    ts = ts.replace('Z', '+00:00')
    dt = datetime.fromisoformat(ts)
else:
    dt = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)
print(int(dt.timestamp()))
" 2>/dev/null)
    if [[ -z "$reload_epoch" ]]; then
      echo "  document-server (data): SKIP (failed to parse last_reload)"
      return
    fi
  fi

  local newest_yaml_epoch
  newest_yaml_epoch=$(newest_file_epoch "$data_dir" "*.yaml" "*.yml")

  if [[ -z "$newest_yaml_epoch" ]]; then
    echo "  document-server (data): SKIP (no YAML files)"
    return
  fi

  if [[ "$newest_yaml_epoch" -gt "$reload_epoch" ]]; then
    echo "  document-server (data): STALE (YAML updated after last reload, run: curl -sX POST http://localhost:3002/admin/reload)"
    STALE+=("document-server-data")
  else
    echo "  document-server (data): OK"
  fi
}

# ============================================================
# Rebuild helpers
# ============================================================

# Reinitialize PostgreSQL via switch-env.sh (called at most once per rebuild run)
maybe_reinitialize_postgres() {
  if ! $postgres_reinitialized; then
    echo "  Reinitializing PostgreSQL: scripts/switch-env.sh --force-reload -y $CURRENT_DATA_ENV"
    if ! scripts/switch-env.sh --force-reload -y "$CURRENT_DATA_ENV"; then
      echo "  ERROR: PostgreSQL reinitialization failed" >&2
      return 1
    fi
    postgres_reinitialized=true
  else
    echo "  PostgreSQL already reinitialized (skipping duplicate switch-env)"
  fi
}

# ============================================================
# Main execution
# ============================================================

echo "=== Freshness Check ==="
echo ""
echo "DATA_ENV: $CURRENT_DATA_ENV"
echo ""

# Check Docker services (only if running)
echo "Docker services:"
if is_service_running "jupyter-server"; then
  check_docker_service "jupyter-server" "jupyter-server"
else
  echo "  jupyter-server: SKIP (not running)"
fi

if is_service_running "document-server"; then
  check_docker_service "document-server" "document-server"
  check_document_data
else
  echo "  document-server: SKIP (not running)"
  echo "  document-server (data): SKIP (not running)"
fi

echo ""
echo "PostgreSQL:"
check_postgres_init
check_postgres_data

echo ""
echo "MCP servers:"
check_mcp_build "jupyter-mcp"
check_mcp_build "document-mcp"

echo ""

if [[ ${#STALE[@]} -gt 0 ]]; then
  echo "WARNING: Stale components: ${STALE[*]}"

  if $REBUILD; then
    echo ""
    echo "Auto-rebuilding stale components..."
    postgres_reinitialized=false
    rebuild_failed=()
    for component in "${STALE[@]}"; do
      case "$component" in
        jupyter-server|document-server)
          echo "  Rebuilding Docker service: $component"
          if ! docker compose build "$component" || ! docker compose up -d "$component"; then
            echo "  ERROR: Failed to rebuild $component" >&2
            rebuild_failed+=("$component")
          fi
          ;;
        jupyter-mcp|document-mcp)
          echo "  Rebuilding MCP server: $component"
          if ! (cd "$component" && npm run build); then
            echo "  ERROR: Failed to build $component" >&2
            rebuild_failed+=("$component")
          fi
          ;;
        postgres-init)
          echo "  Regenerating init scripts: scripts/generate-init-scripts.sh $CURRENT_DATA_ENV"
          if ! scripts/generate-init-scripts.sh "$CURRENT_DATA_ENV"; then
            echo "  ERROR: Failed to regenerate init scripts" >&2
            rebuild_failed+=("$component")
          else
            if ! maybe_reinitialize_postgres; then
              rebuild_failed+=("$component")
            fi
          fi
          ;;
        postgres-data)
          if ! maybe_reinitialize_postgres; then
            rebuild_failed+=("$component")
          fi
          ;;
        document-server-data)
          echo "  Reloading document-server catalog via /admin/reload"
          if curl -sf -X POST http://localhost:3002/admin/reload | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['data']['status']=='reloaded'" 2>/dev/null; then
            echo "  document-server catalog reloaded"
          else
            echo "  WARNING: /admin/reload failed, falling back to restart"
            if ! docker compose restart document-server; then
              echo "  ERROR: Failed to restart document-server" >&2
              rebuild_failed+=("$component")
            fi
          fi
          ;;
      esac
    done
    if [[ ${#rebuild_failed[@]} -gt 0 ]]; then
      echo "ERROR: Rebuild failed for: ${rebuild_failed[*]}" >&2
      exit 1
    fi
    echo "Rebuild complete."
  elif $STRICT; then
    echo "ERROR: Stale components detected (--strict mode). Run with --rebuild to auto-fix." >&2
    exit 1
  else
    echo "Hint: Run with --rebuild to auto-fix, or rebuild manually."
  fi
else
  echo "All components are up to date."
fi
