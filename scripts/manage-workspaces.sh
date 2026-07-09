#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v jq >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: jq がインストールされていません。

このスクリプトは jupyter-server API レスポンスの JSON 処理に jq を必要とします。
インストール:
  Debian/Ubuntu: sudo apt-get install -y jq
  macOS:         brew install jq
EOF
  exit 1
fi

usage() {
  cat <<EOF
Usage: $(basename "$0") COMMAND [OPTIONS]

jupyter-server のワークスペースを管理します。

COMMANDS:
  list                          ワークスペース一覧を表示
  delete WORKSPACE_ID           指定したワークスペースを再帰削除
  delete-all                    全ワークスペースを再帰削除

OPTIONS:
  -y, --yes                     確認プロンプトをスキップ（delete / delete-all）
  --dry-run                     削除対象を表示するだけで実際には削除しない
  --jupyter-url URL             jupyter-server の URL (default: http://localhost:8888)

Examples:
  $(basename "$0") list
  $(basename "$0") delete ws-c3e9a73c
  $(basename "$0") delete-all -y
  $(basename "$0") delete-all --dry-run
EOF
}

JUPYTER_URL="http://localhost:8888"
ASSUME_YES=0
DRY_RUN=0

# JUPYTER_TOKEN を .env から読み込み（環境変数で上書き可能）
if [[ -z "${JUPYTER_TOKEN:-}" ]] && [[ -f .env ]]; then
  JUPYTER_TOKEN=$(grep -E '^JUPYTER_TOKEN=' .env 2>/dev/null | cut -d= -f2- || echo "")
fi
JUPYTER_TOKEN="${JUPYTER_TOKEN:-dev-token}"

# -----------------------------------------------------------------------------
# 内部ヘルパー
# -----------------------------------------------------------------------------

encode_path() {
  # スラッシュや日本語を URL エンコード（jq の @uri を利用）
  jq -rn --arg s "$1" '$s | @uri'
}

api_get() {
  local url="$1"
  curl -sS -H "Authorization: token ${JUPYTER_TOKEN}" "${url}"
}

api_delete() {
  local url="$1"
  curl -sS -o /dev/null -w "%{http_code}" \
    -X DELETE -H "Authorization: token ${JUPYTER_TOKEN}" "${url}"
}

list_children() {
  # 指定パスの子エントリを "type:name" で列挙（ディレクトリ以外は空出力）
  local path="$1"
  local enc
  enc=$(encode_path "${path}")
  api_get "${JUPYTER_URL}/api/custom/contents/${enc}" \
    | jq -r '(.data.content // []) | .[] | "\(.type):\(.name)"' 2>/dev/null || true
}

delete_recursive() {
  # ディレクトリなら中身を先に削除してから本体を削除
  local path="$1"
  local enc
  enc=$(encode_path "${path}")

  local children
  children=$(list_children "${path}")
  if [[ -n "${children}" ]]; then
    while IFS= read -r entry; do
      [[ -z "${entry}" ]] && continue
      local cname="${entry#*:}"
      delete_recursive "${path}/${cname}"
    done <<< "${children}"
  fi

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "  [dry-run] DELETE ${path}"
    return 0
  fi

  local code
  code=$(api_delete "${JUPYTER_URL}/api/custom/contents/${enc}")
  echo "  DELETE ${path} -> ${code}"
  if [[ "${code}" != "200" ]]; then
    return 1
  fi
}

confirm() {
  local prompt="$1"
  if [[ "${ASSUME_YES}" -eq 1 || "${DRY_RUN}" -eq 1 ]]; then
    return 0
  fi
  read -r -p "${prompt} [y/N]: " answer
  [[ "${answer}" == "y" || "${answer}" == "Y" ]]
}

fetch_workspaces_json() {
  api_get "${JUPYTER_URL}/api/workspaces"
}

# -----------------------------------------------------------------------------
# サブコマンド
# -----------------------------------------------------------------------------

cmd_list() {
  local json
  json=$(fetch_workspaces_json)
  local count
  count=$(echo "${json}" | jq '.data.workspaces | length')
  echo "=== Workspaces (${count}) ==="
  echo "${json}" | jq -r '.data.workspaces[] |
    "[\(.status)] \(.workspace_id) \(.name) (files: \(.file_count))\n    path: \(.path)\n    summary: \(.summary)"'
}

cmd_delete_one() {
  local ws_id="$1"
  local json
  json=$(fetch_workspaces_json)

  local base
  base=$(echo "${json}" | jq -r --arg id "${ws_id}" \
    '.data.workspaces[] | select(.workspace_id==$id) | .path')

  if [[ -z "${base}" || "${base}" == "null" ]]; then
    echo "Error: workspace not found: ${ws_id}" >&2
    exit 1
  fi

  echo "Target: ${ws_id} (${base})"
  if ! confirm "Delete this workspace recursively?"; then
    echo "Cancelled."
    return 0
  fi

  delete_recursive "${base}"
}

cmd_delete_all() {
  local json
  json=$(fetch_workspaces_json)
  local count
  count=$(echo "${json}" | jq '.data.workspaces | length')

  if [[ "${count}" -eq 0 ]]; then
    echo "No workspaces to delete."
    return 0
  fi

  echo "=== Delete Target (${count}) ==="
  echo "${json}" | jq -r '.data.workspaces[] |
    "  [\(.status)] \(.workspace_id) \(.name)"'

  if ! confirm "Delete ALL ${count} workspaces recursively?"; then
    echo "Cancelled."
    return 0
  fi

  local pairs
  pairs=$(echo "${json}" | jq -r '.data.workspaces[] | "\(.workspace_id)|\(.path)"')

  while IFS='|' read -r ws_id base; do
    [[ -z "${ws_id}" ]] && continue
    echo "== ${ws_id} (${base}) =="
    delete_recursive "${base}" || echo "  WARN: partial failure for ${ws_id}"
  done <<< "${pairs}"

  echo
  echo "=== 残存確認 ==="
  local remaining
  remaining=$(fetch_workspaces_json | jq -r '.data.workspaces | length')
  echo "remaining: ${remaining}"
  if [[ "${remaining}" -gt 0 ]]; then
    fetch_workspaces_json | jq -r '.data.workspaces[] | "  - \(.workspace_id) \(.name)"'
  fi
}

# -----------------------------------------------------------------------------
# 引数パース
# -----------------------------------------------------------------------------

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

COMMAND="$1"
shift

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)       ASSUME_YES=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --jupyter-url)  JUPYTER_URL="$2"; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    *)              POSITIONAL+=("$1"); shift ;;
  esac
done

case "${COMMAND}" in
  list)
    cmd_list
    ;;
  delete)
    if [[ ${#POSITIONAL[@]} -ne 1 ]]; then
      echo "Error: 'delete' requires WORKSPACE_ID" >&2
      usage
      exit 1
    fi
    cmd_delete_one "${POSITIONAL[0]}"
    ;;
  delete-all)
    cmd_delete_all
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Error: unknown command '${COMMAND}'" >&2
    usage
    exit 1
    ;;
esac
