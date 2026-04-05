#!/usr/bin/env bash
set -euo pipefail

# cleanup-merged-branches.sh — dev にマージ済みのローカルブランチを削除する
#
# 削除対象の条件（すべて満たす場合のみ削除）:
#   - ブランチ名が feature/* または fix/* にマッチ
#   - dev にマージ済み（git branch --merged dev）
#   - main / dev ではない
#   - 現在チェックアウト中のブランチではない

PROTECTED_PATTERN="^(main|dev)$"
TARGET_PATTERN="^(feature|fix)/"

current_branch=$(git branch --show-current)

# dev にマージ済みのブランチを取得
merged_branches=$(git branch --merged dev --format='%(refname:short)' | grep -E "$TARGET_PATTERN" || true)

if [[ -z "$merged_branches" ]]; then
  exit 0
fi

deleted=()
while IFS= read -r branch; do
  [[ -z "$branch" ]] && continue
  if [[ "$branch" =~ $PROTECTED_PATTERN ]]; then
    continue
  fi
  if [[ "$branch" == "$current_branch" ]]; then
    continue
  fi
  if git branch -d "$branch" >/dev/null 2>&1; then
    deleted+=("$branch")
  fi
done <<< "$merged_branches"

if [[ ${#deleted[@]} -gt 0 ]]; then
  echo "Cleaned up merged local branches:"
  printf '  - %s\n' "${deleted[@]}"
fi
