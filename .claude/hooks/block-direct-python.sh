#!/bin/bash
set -euo pipefail

# python / python3 / pip / pip3 の直叩きを検出してブロックする hook。
# uv run python / uv run pip 経由は通過させる。
#
# ルール: .claude/rules/python-uv.md
#
# フック応答:
#   exit 0 = 許可（直叩きなし）
#   exit 2 = ブロック（stderr の指示に従って Claude が自己修正）

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# uv run 経由の python/pip 呼び出しを除外（macOS 互換: \b を使わず空白/EOL で終端を判定）
stripped=$(printf '%s' "$COMMAND" | sed -E 's/uv[[:space:]]+run[[:space:]]+(python3?|pip3?)([[:space:]]|$)/UV_RUN_OK\2/g')

# コメント（# 以降）を除去して純粋な実行コマンド部分のみチェック
# ※ '#' を含む行でも非コメント部分に python3 があればブロック対象
stripped=$(printf '%s' "$stripped" | sed -E 's/#.*//')

# 残った文字列に対し、単語境界で python/pip が出現するか検出
# トークン境界: 行頭、空白、セミコロン、アンパサンド、パイプ、バッククオート、括弧
if printf '%s' "$stripped" | grep -qE '(^|[[:space:];&|`(])((/[^[:space:]]*/)?python3?|(/[^[:space:]]*/)?pip3?)([[:space:];&|`)]|$)'; then
  cat >&2 <<EOF
========================================
 BLOCKED: python/pip の直叩きは禁止されています
========================================

直接 python/python3/pip/pip3 を呼び出してはなりません。
uv run 経由で実行してください:

  python script.py        → uv run python script.py
  python3 -c "..."        → uv run python -c "..."
  pip install foo         → uv run pip install foo（または uv add --dev foo）

詳細: .claude/rules/python-uv.md
========================================
EOF
  echo "Offending command: $COMMAND" >&2
  exit 2
fi

exit 0
