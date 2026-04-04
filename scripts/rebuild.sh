#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/lib/common.sh

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [SERVICE...]

Docker コンテナをリビルドして起動します。
postgres のデータが古い場合は自動的に再初期化します。

SERVICE:
  jupyter-server    Jupyter サーバーのみ
  document-server   Document サーバーのみ
  postgres          PostgreSQL のみ（常に再初期化）
  (省略時は全サービス)

OPTIONS:
  --clean       キャッシュなしで完全リビルド（postgres も常に再初期化）
  --reset       ボリュームも削除して完全初期化 (データが消えます)
  --verify      リビルド後にスモークテストを実行
  --down-only   停止のみ (リビルドしない)
  -h, --help    このヘルプを表示

postgres データの再初期化:
  全サービスまたは postgres 指定時、init スクリプトや CSV が
  コンテナより新しい場合に postgres を再初期化します。
  --clean または postgres 明示指定時は常に再初期化します。

Examples:
  $(basename "$0")                          # 全サービスをリビルド＆起動
  $(basename "$0") jupyter-server           # jupyter-server のみリビルド
  $(basename "$0") postgres                 # postgres を再初期化
  $(basename "$0") --clean                  # キャッシュなしで完全リビルド
  $(basename "$0") --reset                  # 全削除して初期化
  $(basename "$0") --verify                 # リビルド後にスモークテスト実行
EOF
}

CLEAN=false
RESET=false
VERIFY=false
DOWN_ONLY=false
SERVICES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)    CLEAN=true; shift ;;
    --reset)    RESET=true; shift ;;
    --verify)   VERIFY=true; shift ;;
    --down-only) DOWN_ONLY=true; shift ;;
    -h|--help)  usage; exit 0 ;;
    -*)         echo "Error: unknown option '$1'" >&2; usage; exit 1 ;;
    *)          SERVICES+=("$1"); shift ;;
  esac
done

# ============================================================
# Read DATA_ENV from .env
# ============================================================

DATA_ENV=$(read_data_env)
validate_env "$DATA_ENV" || exit 1

# ============================================================
# Helper functions
# ============================================================

# prune_docker_garbage, newest_file_epoch, container_epoch are provided by scripts/lib/common.sh

# Check if SERVICES array includes postgres or is empty (all services)
is_postgres_in_scope() {
  if [[ -z "${SERVICES[@]+x}" ]]; then
    return 0  # all services → postgres is in scope
  fi
  for s in "${SERVICES[@]}"; do
    if [[ "$s" == "postgres" ]]; then
      return 0
    fi
  done
  return 1
}

# Check if postgres needs reinitalization
# Returns 0 (true) if reinit needed, 1 (false) otherwise
# Side effect: runs generate-init-scripts.sh if catalog YAML is newer than init scripts
check_postgres_needs_reinit() {
  # --clean or explicit postgres → always reinit
  if $CLEAN; then
    echo "  postgres: reinit required (--clean)"
    return 0
  fi

  # Explicit postgres service → always reinit
  for s in ${SERVICES[@]+"${SERVICES[@]}"}; do
    if [[ "$s" == "postgres" ]]; then
      echo "  postgres: reinit required (explicit postgres)"
      return 0
    fi
  done

  local catalog_dir="document-server/data/${DATA_ENV}/catalog"
  local init_dir="postgres/init/${DATA_ENV}"
  local data_dir="postgres/data/${DATA_ENV}"

  # Layer 1: catalog YAML vs init scripts
  if [[ -d "$catalog_dir" ]] && [[ -d "$init_dir" ]]; then
    local newest_yaml
    newest_yaml=$(newest_file_epoch "$catalog_dir" "*.yaml" "*.yml")
    local newest_init
    newest_init=$(newest_file_epoch "$init_dir" "*.sql" "*.sh" "*.py")

    if [[ -n "$newest_yaml" ]] && [[ -n "$newest_init" ]] && [[ "$newest_yaml" -gt "$newest_init" ]]; then
      echo "  postgres: catalog YAML newer than init scripts, regenerating..."
      scripts/generate-init-scripts.sh "$DATA_ENV"
      return 0
    fi
  elif [[ -d "$catalog_dir" ]] && [[ ! -d "$init_dir" ]]; then
    echo "  postgres: init dir not found, regenerating..."
    scripts/generate-init-scripts.sh "$DATA_ENV"
    return 0
  fi

  # Layer 2: init scripts + CSV vs postgres container
  local pg_epoch
  pg_epoch=$(container_epoch "postgres")

  if [[ -z "$pg_epoch" ]]; then
    echo "  postgres: container not found, reinit required"
    return 0
  fi

  # Check init scripts vs container
  if [[ -d "$init_dir" ]]; then
    local init_epoch
    init_epoch=$(newest_file_epoch "$init_dir" "*.sql" "*.sh" "*.py")
    if [[ -n "$init_epoch" ]] && [[ "$init_epoch" -gt "$pg_epoch" ]]; then
      echo "  postgres: init scripts newer than container"
      return 0
    fi
  fi

  # Check data files (CSV/Parquet) vs container
  if [[ -d "$data_dir" ]]; then
    local newest_data
    newest_data=$(newest_file_epoch "$data_dir" "*.csv" "*.parquet")
    if [[ -n "$newest_data" ]] && [[ "$newest_data" -gt "$pg_epoch" ]]; then
      echo "  postgres: data files newer than container"
      return 0
    fi
  fi

  echo "  postgres: up to date"
  return 1
}

# Wait for postgres to be ready and initialized
wait_for_postgres_init() {
  local init_timeout
  if [[ "$DATA_ENV" == "production" ]]; then
    init_timeout=120
  else
    init_timeout=60
  fi

  wait_for_postgres_ready "${POSTGRES_USER:-jupyter}" 30
  wait_for_db_init "${POSTGRES_USER:-jupyter}" "${POSTGRES_DB:-analysis_db}" "$init_timeout"
}

# run_load_data is provided by scripts/lib/common.sh

# Reinitialize postgres: stop → remove volume → start → wait
reinitialize_postgres() {
  echo ""
  echo "--- Reinitializing PostgreSQL (${DATA_ENV}) ---"

  # Stop and remove postgres container
  docker compose rm -fs postgres 2>/dev/null || true

  # Remove environment-specific postgres volume
  remove_postgres_volume "$DATA_ENV"

  # Start postgres
  docker compose up -d postgres

  # Wait for table creation (init scripts run inside container)
  wait_for_postgres_init

  # Load data from host
  run_load_data "$DATA_ENV"
}

# ============================================================
# Main execution
# ============================================================

echo "=== Docker Rebuild ==="

# --down-only: 停止のみ
if $DOWN_ONLY; then
  echo "Stopping containers..."
  docker compose down
  echo "Done."
  exit 0
fi

# --reset: ボリューム含めて完全初期化
if $RESET; then
  echo "WARNING: ボリューム (postgres_data_${DATA_ENV}, jupyter_work) も削除されます。"
  read -p "続行しますか? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "中止しました。"
    exit 0
  fi
  echo "Stopping and removing volumes..."
  docker compose down --remove-orphans
  remove_postgres_volume "$DATA_ENV"
  # jupyter_work ボリュームも削除（元の down -v と同等）
  jw_vol="$(get_compose_project_name)_jupyter_work"
  if docker volume inspect "$jw_vol" >/dev/null 2>&1; then
    echo "  Removing volume: $jw_vol"
    docker volume rm "$jw_vol"
  fi
  echo "Building (no cache)..."
  docker compose build --no-cache
  echo "Starting..."
  docker compose up -d
  prune_docker_garbage
  echo ""
  echo "--- Waiting for PostgreSQL initialization ---"
  wait_for_postgres_init
  echo ""
  echo "--- Loading data from host ---"
  run_load_data "$DATA_ENV"
  echo ""
  echo "Done. (full reset)"
  if $VERIFY; then
    echo ""
    echo "=== Post-build Verification ==="
    echo "Waiting for services to be ready..."
    sleep 5
    scripts/smoke-test.sh
  fi
  exit 0
fi

# 通常リビルド or --clean
POSTGRES_REINITIALIZED=false

# Step 1: postgres 鮮度チェック + 再初期化（スコープ内の場合）
if is_postgres_in_scope; then
  echo ""
  echo "--- PostgreSQL freshness check (DATA_ENV: ${DATA_ENV}) ---"
  if check_postgres_needs_reinit; then
    reinitialize_postgres
    POSTGRES_REINITIALIZED=true
  fi
fi

# Step 2: build + up -d
if [[ -z "${SERVICES[@]+x}" ]]; then
  # 全サービス
  if $CLEAN; then
    echo "Building all services (no cache)..."
    docker compose build --no-cache
  else
    echo "Building all services..."
    docker compose build
  fi
  echo "Starting all services..."
  docker compose up -d
else
  # 特定サービス
  if $CLEAN; then
    echo "Building ${SERVICES[*]} (no cache)..."
    docker compose build --no-cache "${SERVICES[@]}"
  else
    echo "Building ${SERVICES[*]}..."
    docker compose build "${SERVICES[@]}"
  fi
  echo "Starting ${SERVICES[*]}..."
  docker compose up -d "${SERVICES[@]}"
fi

prune_docker_garbage

echo ""
echo "=== Container Status ==="
docker compose ps

# Run smoke test if --verify
if $VERIFY; then
  echo ""
  echo "=== Post-build Verification ==="
  echo "Waiting for services to be ready..."
  sleep 5
  scripts/smoke-test.sh
fi
