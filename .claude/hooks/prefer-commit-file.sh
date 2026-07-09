#!/bin/bash

# git commit -m "..." や heredoc 形式のコミットメッセージを検出し、
# tmp/commit-msg.txt に Write → git commit -F tmp/commit-msg.txt 方式へ
# 自己修正させる PreToolUse hook。
#
# 狙い: -m や heredoc 形式はコマンドが長くなり許可リストのマッチや
#       他フック（block-compound-commands, block-heredoc-adhoc）との
#       干渉が起きやすい。-F 方式なら常にシンプルな単一コマンドになる。
#
# ルール: .claude/rules/general.md「コミット規約」
#
# フック応答:
#   exit 0 = 許可（-F 形式、または git commit 以外）
#   exit 2 = ブロック（stderr の指示に従って Claude が自己修正）

# shellcheck source=lib/json.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

INPUT=$(cat)
COMMAND=$(json_get_path "$INPUT" .tool_input.command)

[[ -z "$COMMAND" ]] && exit 0

STRIPPED=$(echo "$COMMAND" | sed 's/^[[:space:]]*//')

# git commit 以外は対象外
if ! echo "$STRIPPED" | grep -qE '^git[[:space:]]+commit'; then
  exit 0
fi

# git commit -F ... は正規形 → 許可
if echo "$STRIPPED" | grep -qE '^git[[:space:]]+commit[[:space:]].*-F[[:space:]]'; then
  exit 0
fi

# git commit --amend --no-edit など、メッセージ不要のパターンは許可
if echo "$STRIPPED" | grep -qE '^git[[:space:]]+commit[[:space:]]+--amend[[:space:]]+--no-edit'; then
  exit 0
fi

# -m / heredoc / その他 → ブロックして -F 方式へ誘導
cat >&2 <<'EOF'
========================================
 BLOCKED: git commit は -F 方式で実行してください
========================================

コミットメッセージを -m や heredoc で渡さず、
以下の手順で実行してください:

1. Write ツールで tmp/commit-msg.txt にメッセージを書き出す
   （形式は .claude/rules/general.md のコミット規約に従う）
2. git commit -F tmp/commit-msg.txt
3. rm tmp/commit-msg.txt

  NG: git commit -m "feat: ..."
  NG: git commit -m "$(cat <<'COMMIT' ... COMMIT )"
  OK: git commit -F tmp/commit-msg.txt

理由: -F 方式ならコマンドが常にシンプルな単一コマンドになり、
許可リストに確実にマッチして承認プロンプトが出ません。
========================================
EOF
exit 2
