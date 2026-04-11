#!/bin/bash

# PostToolUse hook: Edit/Write 後にファイルの lint + format を自動実行する
#
# 対象:
#   - .ts, .tsx, .js, .jsx, .json → Prettier
#   - .py → Ruff (format + lint --fix)
#
# フック応答:
#   出力なし + exit 0 = 正常（デフォルト動作に委ねる）
#   exit 2 = ブロック（使用しない）

# shellcheck source=lib/json.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

INPUT=$(cat)
TOOL_NAME=$(json_get_path "$INPUT" .tool_name)
FILE_PATH=$(json_get_path "$INPUT" .tool_input.file_path)

# Edit / Write 以外は対象外
if [[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]]; then
  exit 0
fi

if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# node_modules, dist, .git 内のファイルは対象外
if echo "$FILE_PATH" | grep -qE '(node_modules|dist|\.git)/'; then
  exit 0
fi

# プロジェクトディレクトリを基準にする
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

EXT="${FILE_PATH##*.}"

case "$EXT" in
  ts|tsx|js|jsx|json)
    npx --prefix "$PROJECT_DIR" prettier --write "$FILE_PATH" 2>/dev/null
    ;;
  py)
    ruff format "$FILE_PATH" 2>/dev/null
    ruff check --fix "$FILE_PATH" 2>/dev/null
    ;;
esac

exit 0
