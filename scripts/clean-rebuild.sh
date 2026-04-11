#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/lib/common.sh

PROJECT_DIR="$(pwd)"
COMPOSE_PROJECT=$(get_compose_project_name)

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Docker コンテナ・イメージ・ボリュームを全削除し、MCP サーバーとDockerを
クリーンビルドして動作確認まで行います。

処理内容:
  1. Docker コンテナ停止 + ボリューム削除
  2. プロジェクトの Docker イメージ削除
  3. MCP サーバー (jupyter-mcp, document-mcp) のクリーンビルド
  4. Docker イメージのビルド (キャッシュなし)
  5. Docker コンテナ起動
  6. ヘルスチェック待機
  7. PostgreSQL データロード
  8. スモークテスト実行

OPTIONS:
  --env ENV       データ環境を指定 (sample|production, 省略時は .env の値を使用)
  --skip-mcp      MCP サーバーのビルドをスキップ
  --skip-smoke    スモークテストをスキップ
  --keep-volumes  ボリューム (postgres_data_*, jupyter_work) を保持
  --yes, -y       確認プロンプトをスキップ
  -h, --help      このヘルプを表示

Examples:
  $(basename "$0")                    # 完全クリーンビルド（確認あり）
  $(basename "$0") --env sample -y    # sample 環境で確認なし実行
  $(basename "$0") --env production   # production 環境で実行
  $(basename "$0") --keep-volumes     # データを保持してリビルド
  $(basename "$0") --skip-smoke       # スモークテストなし
EOF
}

SKIP_MCP=false
SKIP_SMOKE=false
KEEP_VOLUMES=false
SKIP_CONFIRM=false
TARGET_ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --env requires a value (sample|production)" >&2; exit 1
      fi
      validate_env "$2" || exit 1
      TARGET_ENV="$2"; shift 2 ;;
    --skip-mcp)      SKIP_MCP=true; shift ;;
    --skip-smoke)    SKIP_SMOKE=true; shift ;;
    --keep-volumes)  KEEP_VOLUMES=true; shift ;;
    --yes|-y)        SKIP_CONFIRM=true; shift ;;
    -h|--help)       usage; exit 0 ;;
    -*)              echo "Error: unknown option $1" >&2; usage; exit 1 ;;
    *)               echo "Error: unexpected argument $1" >&2; usage; exit 1 ;;
  esac
done

# 環境の決定: --env 指定があれば使用、なければ .env の値、なければ sample
if [[ -z "$TARGET_ENV" ]]; then
  TARGET_ENV=$(read_data_env)
  validate_env "$TARGET_ENV" || exit 1
fi

# ---- 確認 ----
if ! $SKIP_CONFIRM; then
  echo "=== Clean Rebuild (${TARGET_ENV}) ==="
  echo ""
  echo "以下の操作を行います:"
  echo "  - データ環境: ${TARGET_ENV}"
  echo "  - Docker コンテナを全て停止・削除"
  if ! $KEEP_VOLUMES; then
    echo "  - ボリューム (postgres_data_${TARGET_ENV}, jupyter_work) を削除"
  fi
  echo "  - プロジェクトの Docker イメージを削除"
  if ! $SKIP_MCP; then
    echo "  - MCP サーバーをクリーンビルド (jupyter-mcp, document-mcp)"
  fi
  echo "  - Docker イメージをキャッシュなしでビルド"
  echo "  - Docker コンテナを起動"
  if ! $SKIP_SMOKE; then
    echo "  - スモークテストを実行"
  fi
  echo ""
  read -p "続行しますか? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "中止しました。"
    exit 0
  fi
fi

# ---- .env の DATA_ENV を更新 ----
echo ""
echo "=== Setting DATA_ENV=${TARGET_ENV} ==="
set_data_env_in_dotenv "$TARGET_ENV"
echo "  DATA_ENV=${TARGET_ENV}"

STEP=0
step() {
  STEP=$((STEP + 1))
  echo ""
  echo "========================================="
  echo "  Step $STEP: $1"
  echo "========================================="
}

elapsed_since() {
  local start=$1
  local now
  now=$(date +%s)
  echo $(( now - start ))
}

TOTAL_START=$(date +%s)

# ---- Step 1: Docker コンテナ停止 + 削除 ----
step "Docker コンテナ停止 + 削除"

if $KEEP_VOLUMES; then
  echo "Stopping and removing containers (volumes preserved)..."
  docker compose down --remove-orphans 2>/dev/null || true
else
  echo "Stopping and removing containers + volumes..."
  docker compose down --remove-orphans 2>/dev/null || true
  remove_postgres_volume "$TARGET_ENV"
  remove_legacy_postgres_volume
  # jupyter_work ボリュームも削除
  jw_vol="$(get_compose_project_name)_jupyter_work"
  if docker volume inspect "$jw_vol" >/dev/null 2>&1; then
    echo "  Removing volume: $jw_vol"
    docker volume rm "$jw_vol" 2>/dev/null || true
  fi
fi
echo "Done."

# ---- Step 2: Docker イメージ削除 ----
step "プロジェクトの Docker イメージ削除"

# docker compose が生成するイメージ名を特定して削除
# Collect image IDs from multiple sources into a single list
collect_image_ids() {
  docker compose images -q 2>/dev/null || true
  docker images --format '{{.ID}} {{.Repository}}' 2>/dev/null | \
    grep -i "$COMPOSE_PROJECT" | awk '{print $1}' || true
  for name in jupyter-server document-server; do
    docker images --format '{{.ID}} {{.Repository}}' 2>/dev/null | \
      grep -i "$name" | awk '{print $1}' || true
  done
}

UNIQUE_IMAGES=$(collect_image_ids | sort -u)

if [[ -n "$UNIQUE_IMAGES" ]]; then
  echo "Removing project images..."
  echo "$UNIQUE_IMAGES" | while read -r img; do
    docker rmi -f "$img" 2>/dev/null || true
  done
  echo "Done."
else
  echo "No project images found. Skipping."
fi

prune_docker_garbage

# ---- Step 3: MCP サーバーのクリーンビルド ----
if ! $SKIP_MCP; then
  step "MCP サーバーのクリーンビルド"
  scripts/rebuild-mcp.sh --clean
fi

# ---- Step 4: Docker イメージのビルド ----
step "Docker イメージのビルド (キャッシュなし)"

echo "Building all services with --no-cache..."
docker compose build --no-cache
echo "Done."

# ---- Step 5: Docker コンテナ起動 ----
step "Docker コンテナ起動"

echo "Starting all services..."
docker compose up -d
echo ""
echo "Container status:"
docker compose ps

# ---- Step 6: ヘルスチェック待機 ----
step "ヘルスチェック待機"

SERVICES_TO_CHECK=(postgres jupyter-server document-server)
HEALTHY_SERVICES=()

# Check if a service is already marked healthy
is_service_healthy() {
  local svc=$1
  printf '%s\n' "${HEALTHY_SERVICES[@]}" 2>/dev/null | grep -q "^${svc}$"
}

# Get health status of a service via docker compose JSON output
get_service_health() {
  local svc=$1
  docker compose ps --format json "$svc" 2>/dev/null | uv run python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        data = data[0]
    health = data.get('Health', data.get('State', ''))
    print(health)
except Exception as e:
    print(f'WARN: health check parse failed for input: {e}', file=sys.stderr)
    print('unknown')
" 2>/dev/null || echo "unknown"
}

MAX_WAIT=120
WAIT_INTERVAL=5
WAITED=0

echo "Waiting for all services to become healthy (max ${MAX_WAIT}s)..."
echo ""

while [[ $WAITED -lt $MAX_WAIT ]]; do
  ALL_HEALTHY=true

  for svc in "${SERVICES_TO_CHECK[@]}"; do
    if is_service_healthy "$svc"; then
      continue
    fi

    if [[ "$(get_service_health "$svc")" == "healthy" ]]; then
      echo "  [${WAITED}s] $svc: healthy"
      HEALTHY_SERVICES+=("$svc")
    else
      ALL_HEALTHY=false
    fi
  done

  if $ALL_HEALTHY; then
    break
  fi

  sleep "$WAIT_INTERVAL"
  WAITED=$((WAITED + WAIT_INTERVAL))
done

echo ""
if [[ ${#HEALTHY_SERVICES[@]} -eq ${#SERVICES_TO_CHECK[@]} ]]; then
  echo "All services are healthy."
else
  UNHEALTHY=()
  for svc in "${SERVICES_TO_CHECK[@]}"; do
    if ! is_service_healthy "$svc"; then
      UNHEALTHY+=("$svc")
    fi
  done
  echo "WARNING: Not healthy after ${MAX_WAIT}s: ${UNHEALTHY[*]}" >&2
  echo "Current status:"
  docker compose ps
  echo ""
  echo "Continuing anyway..."
fi

# ---- Step 7: データロード ----
if ! $KEEP_VOLUMES; then
  step "PostgreSQL データロード"
  run_load_data "$TARGET_ENV"
fi

# ---- Step 8: スモークテスト ----
if ! $SKIP_SMOKE; then
  step "スモークテスト"

  # ヘルスチェック後さらに少し待つ（起動直後の安定化）
  echo "Waiting 5s for services to stabilize..."
  sleep 5

  scripts/smoke-test.sh
fi

# ---- 完了 ----
TOTAL_ELAPSED=$(elapsed_since "$TOTAL_START")
echo ""
echo "========================================="
echo "  Clean Rebuild Complete (${TARGET_ENV})"
echo "  Total time: ${TOTAL_ELAPSED}s"
echo "========================================="
echo ""
docker compose ps
