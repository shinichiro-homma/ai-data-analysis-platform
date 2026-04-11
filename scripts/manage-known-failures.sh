#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v jq >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: jq がインストールされていません。

このスクリプトは known-failures.json の JSON CRUD に jq を必要とします。
インストール:
  Debian/Ubuntu: sudo apt-get install -y jq
  macOS:         brew install jq
EOF
  exit 1
fi

KF_FILE="tests/known-failures.json"

usage() {
  cat <<EOF
Usage: $(basename "$0") COMMAND [OPTIONS]

既知テスト失敗（known-failures.json）を管理します。

COMMANDS:
  list                          一覧表示
  add --component X --test-name Y --reason Z [OPTIONS]
                                エントリ追加
  remove --id ID                エントリ削除
  check COMPONENT               コンポーネントに既知障害があるか確認

ADD OPTIONS:
  --component COMP    (必須) コンポーネント名
  --test-name NAME    (必須) テスト名
  --reason REASON     (必須) 既知である理由
  --phase PHASE       test or typecheck (default: test)
  --file FILE         テストファイルの相対パス
  --issue N           GitHub Issue 番号
  --task T            PLAN.md のタスク番号

REMOVE OPTIONS:
  --id ID             (必須) 削除するエントリの ID (kf-001 形式)

CHECK:
  exit 0 = 既知障害あり, exit 1 = なし

Examples:
  $(basename "$0") list
  $(basename "$0") add --component jupyter-mcp --test-name "session > create" --reason "タスク8で対応予定"
  $(basename "$0") remove --id kf-001
  $(basename "$0") check jupyter-mcp
EOF
}

ensure_file() {
  if [[ ! -f "$KF_FILE" ]]; then
    echo "Error: $KF_FILE not found"
    exit 1
  fi
}

cmd_list() {
  ensure_file
  local count
  count=$(jq '.failures | length' "$KF_FILE")
  if [[ "$count" -eq 0 ]]; then
    echo "No known failures registered."
    return
  fi
  echo "=== Known Failures ($count) ==="
  jq -r '.failures[] | "[" + .id + "] " + .component + ":" + .phase + " - \"" + .test_name + "\"" + (if .issue_number then " (#" + (.issue_number | tostring) + ")" else "" end) + " - " + .reason' "$KF_FILE"
}

cmd_add() {
  ensure_file
  local component="" test_name="" reason="" phase="test" file="" issue="" task=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --component)  component="$2"; shift 2 ;;
      --test-name)  test_name="$2"; shift 2 ;;
      --reason)     reason="$2"; shift 2 ;;
      --phase)      phase="$2"; shift 2 ;;
      --file)       file="$2"; shift 2 ;;
      --issue)      issue="$2"; shift 2 ;;
      --task)       task="$2"; shift 2 ;;
      *)            echo "Error: unknown option '$1'"; exit 1 ;;
    esac
  done

  if [[ -z "$component" || -z "$test_name" || -z "$reason" ]]; then
    echo "Error: --component, --test-name, --reason are required"
    exit 1
  fi

  if [[ "$phase" != "test" && "$phase" != "typecheck" ]]; then
    echo "Error: --phase must be 'test' or 'typecheck'"
    exit 1
  fi

  # Auto-generate next ID
  local max_num
  max_num=$(jq '[.failures[].id | ltrimstr("kf-") | tonumber] | if length == 0 then 0 else max end' "$KF_FILE")
  local next_num=$((max_num + 1))
  local new_id
  new_id=$(printf "kf-%03d" "$next_num")

  local today
  today=$(date +%Y-%m-%d)

  # Build the new entry
  local entry
  entry=$(jq -n \
    --arg id "$new_id" \
    --arg component "$component" \
    --arg phase "$phase" \
    --arg test_name "$test_name" \
    --arg added_at "$today" \
    --arg reason "$reason" \
    --arg file "$file" \
    --arg issue "$issue" \
    --arg task "$task" \
    '{
      id: $id,
      component: $component,
      phase: $phase,
      test_name: $test_name,
      added_at: $added_at,
      reason: $reason
    }
    + (if $file != "" then {file: $file} else {} end)
    + (if $issue != "" then {issue_number: ($issue | tonumber)} else {issue_number: null} end)
    + (if $task != "" then {related_task: $task} else {related_task: null} end)')

  # Update the file
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq --argjson entry "$entry" --arg now "$now" \
    '.failures += [$entry] | .updated_at = $now' "$KF_FILE" > "$KF_FILE.tmp"
  mv "$KF_FILE.tmp" "$KF_FILE"

  echo "Added: [$new_id] $component:$phase - \"$test_name\""
}

cmd_remove() {
  ensure_file
  local id=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id)  id="$2"; shift 2 ;;
      *)     echo "Error: unknown option '$1'"; exit 1 ;;
    esac
  done

  if [[ -z "$id" ]]; then
    echo "Error: --id is required"
    exit 1
  fi

  # Check if entry exists
  local exists
  exists=$(jq --arg id "$id" '[.failures[] | select(.id == $id)] | length' "$KF_FILE")
  if [[ "$exists" -eq 0 ]]; then
    echo "Error: entry '$id' not found"
    exit 1
  fi

  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq --arg id "$id" --arg now "$now" \
    '.failures = [.failures[] | select(.id != $id)] | .updated_at = $now' "$KF_FILE" > "$KF_FILE.tmp"
  mv "$KF_FILE.tmp" "$KF_FILE"

  echo "Removed: $id"
}

cmd_check() {
  ensure_file
  local component="${1:-}"

  if [[ -z "$component" ]]; then
    echo "Error: component name is required"
    exit 1
  fi

  local count
  count=$(jq --arg comp "$component" '[.failures[] | select(.component == $comp)] | length' "$KF_FILE")
  if [[ "$count" -gt 0 ]]; then
    echo "Known failures for $component: $count"
    exit 0
  else
    exit 1
  fi
}

# Main
if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

COMMAND="$1"; shift

case "$COMMAND" in
  list)    cmd_list ;;
  add)     cmd_add "$@" ;;
  remove)  cmd_remove "$@" ;;
  check)   cmd_check "$@" ;;
  -h|--help) usage ;;
  *)       echo "Error: unknown command '$COMMAND'"; usage; exit 1 ;;
esac
