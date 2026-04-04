#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/lib/common.sh

# --- usage ---
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] <ENV>

環境を切り替えます。既にデータがロード済みの環境にはサービス再起動のみで高速に切り替えます。

ENV:
  sample       サンプルデータ環境（デフォルト）
  production   本番データ環境

Options:
  -h, --help          このヘルプを表示
  -y, --yes           確認プロンプトをスキップ
  --force-reload      データを強制的に再ロード（ボリューム削除→再構築）

Examples:
  $(basename "$0") production              # production に切り替え（データがあればスキップ確認）
  $(basename "$0") -y production           # 確認なし（データがあれば再ロードしない）
  $(basename "$0") --force-reload production  # 強制再ロード
  $(basename "$0") -y --force-reload production  # 確認なしで強制再ロード
EOF
}

# --- ヘルパー関数 ---

# サービスを停止（postgres, document-server, jupyter-server）
stop_services() {
  echo ""
  echo "=== Stopping services ==="
  docker compose rm -fs postgres document-server jupyter-server
}

# アプリケーションサービスを起動（document-server, jupyter-server）
start_app_services() {
  local env="$1"

  echo ""
  echo "=== Starting document-server (${env}) ==="
  docker compose up -d document-server
  wait_for_http_service "http://localhost:3002/health" "document-server" 30

  echo ""
  echo "=== Starting jupyter-server (${env}) ==="
  docker compose up -d jupyter-server
  wait_for_http_service "http://localhost:8888/api" "jupyter-server" 60
}

# --- 引数パース ---
SKIP_CONFIRM=false
FORCE_RELOAD=false
ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -y|--yes)  SKIP_CONFIRM=true; shift ;;
    --force-reload) FORCE_RELOAD=true; shift ;;
    -*)        echo "Error: unknown option '$1'" >&2; usage; exit 1 ;;
    *)
      if [[ -n "$ENV" ]]; then
        echo "Error: multiple environments specified" >&2; usage; exit 1
      fi
      validate_env "$1" || exit 1
      ENV="$1"; shift ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "Error: environment is required" >&2
  usage
  exit 1
fi

# --- 現在の環境を表示 ---
CURRENT_ENV=$(read_data_env)
echo "現在の環境: ${CURRENT_ENV}"
echo "切り替え先: ${ENV}"

# --- .env の DATA_ENV を書き換え ---
echo ""
echo "=== Updating .env ==="
set_data_env_in_dotenv "$ENV"
echo "  DATA_ENV=${ENV}"

# --- フロー判定 ---
# RELOAD=true: フルリロード（ボリューム削除→再構築）
# RELOAD=false: スキップフロー（サービス再起動のみ）
RELOAD=true

if $FORCE_RELOAD; then
  echo ""
  echo "  --force-reload が指定されたため、フルリロードを実行します。"
elif postgres_volume_exists "$ENV"; then
  # ボリュームが存在する場合
  if $SKIP_CONFIRM; then
    RELOAD=false
    echo ""
    echo "  ${ENV} のデータは既にロード済みです。サービス再起動のみ実行します。"
  else
    echo ""
    echo "${ENV} のデータは既にロード済みです。"
    read -p "データに更新はありますか？ [y/N] " data_updated
    if [[ "${data_updated}" != "y" && "${data_updated}" != "Y" ]]; then
      RELOAD=false
    fi
  fi
else
  echo ""
  echo "  ${ENV} のデータボリュームが見つかりません。フルデータロードを実行します。"
fi

if $RELOAD; then
  # === フルリロードフロー ===

  # --- 確認プロンプト（-y でない、かつ --force-reload でない場合のみ） ---
  if ! $SKIP_CONFIRM && ! $FORCE_RELOAD; then
    echo ""
    echo "以下の操作を実行します:"
    echo "  1. PostgreSQL データボリュームを削除"
    echo "  2. PostgreSQL を ${ENV} データで再構築"
    echo "  3. document-server を再起動"
    echo "  4. jupyter-server を再起動（ワークスペースルートが ${ENV} に切り替わります）"
    echo ""
    echo "※ jupyter_work ボリューム（ワークスペース）は保持されます"
    read -p "続行しますか? [y/N] " confirm
    if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
      echo "中止しました。"
      exit 0
    fi
  fi

  stop_services

  echo ""
  echo "=== Removing postgres volume (${ENV}) ==="
  remove_postgres_volume "$ENV"

  prune_docker_garbage

  echo ""
  echo "=== Starting PostgreSQL (${ENV}) ==="
  docker compose up -d postgres

  INIT_TIMEOUT=60
  if [[ "$ENV" == "production" ]]; then
    INIT_TIMEOUT=120
  fi
  wait_for_postgres_ready "${POSTGRES_USER:-jupyter}" 30
  wait_for_db_init "${POSTGRES_USER:-jupyter}" "${POSTGRES_DB:-analysis_db}" "$INIT_TIMEOUT"

  echo ""
  echo "=== Loading data from host ==="
  run_load_data "$ENV"

else
  # === スキップフロー（サービス再起動のみ） ===

  stop_services

  echo ""
  echo "=== Starting PostgreSQL (${ENV}, existing data) ==="
  docker compose up -d postgres

  wait_for_postgres_ready "${POSTGRES_USER:-jupyter}" 30
fi

# --- アプリケーションサービス起動（共通） ---
start_app_services "$ENV"

# --- Docker ゴミ掃除 ---
prune_docker_garbage

# --- 完了メッセージ ---
echo ""
echo "=== Done ==="
if $RELOAD; then
  echo "環境を '${ENV}' に切り替えました（フルリロード完了）。"
else
  echo "環境を '${ENV}' に切り替えました（データ再ロードなし）。"
fi
