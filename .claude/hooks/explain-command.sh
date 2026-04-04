#!/bin/bash

# Bash コマンドの実行許可を求める際に、description フィールドの内容を表示する hook
#
# Claude が Bash ツールに渡す description パラメータを抽出し、
# ユーザーが許可判断しやすいよう stderr に表示する。
#
# フック応答:
#   出力なし + exit 0 = デフォルト動作に委ねる（許可判断には関与しない）

INPUT=$(cat)
DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // empty')

if [[ -z "$DESCRIPTION" ]]; then
  exit 0
fi

cat >&2 <<EOF
💡 $DESCRIPTION
EOF

exit 0
