#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  cat <<EOF
Usage: $(basename "$0") --component COMP --test-name NAME [OPTIONS]

テスト失敗の GitHub Issue を作成します。

REQUIRED:
  --component COMP    コンポーネント名
  --test-name NAME    テスト名

OPTIONS:
  --file FILE         テストファイルパス
  --reason REASON     失敗の理由
  --task TASK         関連タスク番号
  --add-known         Issue 作成後に known-failures.json にも追加
  -h, --help          このヘルプを表示

Examples:
  $(basename "$0") --component jupyter-mcp --test-name "session > create" --reason "API変更に未追従"
  $(basename "$0") --component jupyter-mcp --test-name "session > create" --add-known
EOF
}

COMPONENT=""
TEST_NAME=""
FILE=""
REASON=""
TASK=""
ADD_KNOWN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --component)  COMPONENT="$2"; shift 2 ;;
    --test-name)  TEST_NAME="$2"; shift 2 ;;
    --file)       FILE="$2"; shift 2 ;;
    --reason)     REASON="$2"; shift 2 ;;
    --task)       TASK="$2"; shift 2 ;;
    --add-known)  ADD_KNOWN=true; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            echo "Error: unknown option '$1'"; usage; exit 1 ;;
  esac
done

if [[ -z "$COMPONENT" || -z "$TEST_NAME" ]]; then
  echo "Error: --component and --test-name are required"
  usage
  exit 1
fi

# Build issue body
BODY="## テスト失敗

- **コンポーネント:** $COMPONENT
- **テスト名:** $TEST_NAME"

if [[ -n "$FILE" ]]; then
  BODY="$BODY
- **ファイル:** $FILE"
fi

if [[ -n "$REASON" ]]; then
  BODY="$BODY

## 理由

$REASON"
fi

if [[ -n "$TASK" ]]; then
  BODY="$BODY

## 関連タスク

- $TASK"
fi

# Create issue
TITLE="test: $COMPONENT - $TEST_NAME"

echo "Creating issue: $TITLE"
ISSUE_URL=$(gh issue create \
  --title "$TITLE" \
  --label "test-failure" \
  --body "$BODY" 2>&1)

# Extract issue number from URL
ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')

echo "Created: $ISSUE_URL (Issue #$ISSUE_NUMBER)"

# Optionally add to known-failures.json
if $ADD_KNOWN; then
  ADD_ARGS=(--component "$COMPONENT" --test-name "$TEST_NAME" --reason "${REASON:-テスト失敗 (Issue #$ISSUE_NUMBER)}" --issue "$ISSUE_NUMBER")
  if [[ -n "$FILE" ]]; then
    ADD_ARGS+=(--file "$FILE")
  fi
  if [[ -n "$TASK" ]]; then
    ADD_ARGS+=(--task "$TASK")
  fi
  scripts/manage-known-failures.sh add "${ADD_ARGS[@]}"
fi
