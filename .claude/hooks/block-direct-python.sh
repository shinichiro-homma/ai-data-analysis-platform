#!/bin/bash

# python / python3 / pip / pip3 の直叩きを検出してブロックする hook。
# uv run 経由は通過させる。
#
# ルール: .claude/rules/python-uv.md
#
# 前提: 複合コマンド（パイプ・チェーン）は block-compound-commands.sh が
#       上流でブロックするため、ここに届くのは単一コマンドのみ。
#       よって先頭のコマンド名だけを検査すればよい。
#       （旧実装はコマンド文字列全体を substring 照合していたため、
#         文字列リテラル内の "python3 -c" 等を誤検知していた）
#
# フック応答:
#   exit 0 = 許可（直叩きなし）
#   exit 2 = ブロック（stderr の指示に従って Claude が自己修正）

# shellcheck source=lib/json.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

INPUT=$(cat)
COMMAND=$(json_get_path "$INPUT" .tool_input.command)

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# 先頭の空白を除去
STRIPPED=$(echo "$COMMAND" | sed 's/^[[:space:]]*//')

# 先頭の環境変数代入を前方から除去: VAR=value VAR2=value ... command
while echo "$STRIPPED" | grep -qE '^[A-Za-z_][A-Za-z_0-9]*=[^ ]*[[:space:]]+'; do
  STRIPPED=$(echo "$STRIPPED" | sed 's/^[A-Za-z_][A-Za-z_0-9]*=[^ ]* *//')
done

# uv 経由（uv run python / uv run pip / uv add 等）は許可
if echo "$STRIPPED" | grep -qE '^uv([[:space:]]|$)'; then
  exit 0
fi

# 先頭トークンの basename で判定（/usr/bin/python3 や .venv/bin/python も対象）
FIRST_TOKEN="${STRIPPED%%[[:space:]]*}"
BASE="${FIRST_TOKEN##*/}"

case "$BASE" in
  python | python2 | python3 | pip | pip3)
    cat >&2 <<EOF
========================================
 BLOCKED: python/pip の直叩きは禁止されています
========================================

直接 python/python3/pip/pip3 を呼び出してはなりません。
uv run 経由で実行してください:

  python script.py        → uv run python script.py
  python3 -c "..."        → uv run python -c "..."
  pip install foo         → uv add --dev foo（または uv run pip install foo）
  .venv/bin/python x.py   → uv run python x.py

詳細: .claude/rules/python-uv.md
========================================
EOF
    echo "Offending command: $COMMAND" >&2
    exit 2
    ;;
esac

exit 0
