#!/bin/bash

# 許可リストにマッチしない「冗長な別形」を検出し、許可済みの正規形へ
# 自己修正させる PreToolUse hook。
#
# 狙い: 許可済みコマンドと等価なのに別表記のせいで承認プロンプトが出る
#       ケースを、プロンプトの代わりにブロック(exit 2)して Claude に
#       正規形へ書き換え・再実行させる（block-direct-python.sh と同じ方式）。
#
# ルール一覧（新しい対応はここに追記する）:
#   - git -C <path> ...
#       → git ...（作業ディレクトリはプロジェクトルート固定のため -C は不要）
#
# 前提: 複合コマンドは block-compound-commands.sh が上流でブロックするため、
#       ここに届くのは単一コマンドのみ。先頭の形だけを検査すればよい。
#
# フック応答:
#   exit 0 = 許可（正規形、または対象外）
#   exit 2 = ブロック（stderr の指示に従って Claude が書き換え）

# shellcheck source=lib/json.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

INPUT=$(cat)
COMMAND=$(json_get_path "$INPUT" .tool_input.command)

[[ -z "$COMMAND" ]] && exit 0

# 先頭の空白を除去
STRIPPED=$(echo "$COMMAND" | sed 's/^[[:space:]]*//')

# --- ルール: git -C <path> ... → git ... ---
if echo "$STRIPPED" | grep -qE '^git[[:space:]]+-C([[:space:]]|=)'; then
  cat >&2 <<'EOF'
========================================
 BLOCKED: git -C は使わないでください
========================================

作業ディレクトリはプロジェクトルートに固定されています。
`-C <path>` を外して git を直接実行してください
（許可リストの Bash(git add:*) 等にマッチし、承認なしで通ります）。

  NG: git -C /path/to/repo add -A
  OK: git add -A

  NG: git -C /path/to/repo commit -F tmp/commit-msg.txt
  OK: git commit -F tmp/commit-msg.txt
========================================
EOF
  exit 2
fi

exit 0
