#!/bin/bash

# main ブランチでの git commit をブロックする hook
#
# 対象: git commit を含む Bash コマンド
# 動作: main ブランチにいる場合は exit 2 でブロック

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# git commit を含むコマンドを検出
if ! echo "$COMMAND" | grep -qE 'git\s+commit'; then
  exit 0
fi

# プロジェクトディレクトリに移動
cd "$CLAUDE_PROJECT_DIR" || exit 0

# 現在のブランチを確認
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)

if [[ "$CURRENT_BRANCH" == "main" ]]; then
  cat >&2 <<EOF
========================================
 BLOCKED: main ブランチでのコミットは禁止されています
========================================

現在のブランチ: main

作業は dev または feature/* ブランチで行ってください:

  git checkout dev
  git checkout -b feature/xxx

main へのリリースは promote スクリプトを使用してください:

  scripts/promote-to-main.sh

詳細: .claude/rules/branch-workflow.md
========================================
EOF
  exit 2
fi

exit 0
