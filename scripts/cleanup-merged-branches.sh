#!/usr/bin/env bash
set -euo pipefail

# cleanup-merged-branches.sh — 不要ブランチを一括掃除する
#
# Usage:
#   scripts/cleanup-merged-branches.sh [OPTIONS]
#
# Options:
#   --dry-run    削除せず、対象を一覧表示のみ
#   --remote     リモートのマージ済み feature/fix ブランチも削除
#   --all        --remote と同等（ローカル + リモート全掃除）
#
# 常に実行される処理:
#   1. git remote prune origin（リモートで削除済みの追跡参照を削除）
#   2. dev にマージ済みのローカル feature/fix ブランチを削除
#   3. 不要な promote/* ローカルブランチを削除
#
# --remote / --all 指定時に追加される処理:
#   4. dev にマージ済みのリモート feature/fix ブランチを削除

DRY_RUN=false
INCLUDE_REMOTE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --remote|--all) INCLUDE_REMOTE=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

PROTECTED_PATTERN="^(main|dev)$"
TARGET_PATTERN="^(feature|fix)/"
PROMOTE_PATTERN="^promote/"

current_branch=$(git branch --show-current)

total_deleted=0

# --- Step 1: Prune stale remote tracking references ---
echo "=== Pruning stale remote tracking references ==="
prune_output=$(git remote prune origin 2>&1)
if [[ -n "$prune_output" ]]; then
  echo "$prune_output"
else
  echo "  (nothing to prune)"
fi

# --- Step 2: Delete merged local feature/fix branches ---
echo ""
echo "=== Merged local feature/fix branches ==="
merged_local=$(git branch --merged dev --format='%(refname:short)' | grep -E "$TARGET_PATTERN" || true)

if [[ -n "$merged_local" ]]; then
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    [[ "$branch" =~ $PROTECTED_PATTERN ]] && continue
    [[ "$branch" == "$current_branch" ]] && continue
    if $DRY_RUN; then
      echo "  (dry-run) would delete: $branch"
    else
      if git branch -d "$branch" >/dev/null 2>&1; then
        echo "  deleted: $branch"
        ((total_deleted++))
      fi
    fi
  done <<< "$merged_local"
else
  echo "  (none)"
fi

# --- Step 3: Delete local promote/* branches ---
echo ""
echo "=== Local promote/* branches ==="
promote_local=$(git branch --format='%(refname:short)' | grep -E "$PROMOTE_PATTERN" || true)

if [[ -n "$promote_local" ]]; then
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    [[ "$branch" == "$current_branch" ]] && continue
    if $DRY_RUN; then
      echo "  (dry-run) would delete: $branch"
    else
      if git branch -D "$branch" >/dev/null 2>&1; then
        echo "  deleted: $branch"
        ((total_deleted++))
      fi
    fi
  done <<< "$promote_local"
else
  echo "  (none)"
fi

# --- Step 4: Delete merged remote feature/fix branches (opt-in) ---
if $INCLUDE_REMOTE; then
  echo ""
  echo "=== Merged remote feature/fix branches ==="
  merged_remote=$(git branch -r --merged dev | grep -E 'origin/(feature|fix)/' | sed 's|^ *origin/||' || true)

  if [[ -n "$merged_remote" ]]; then
    while IFS= read -r branch; do
      [[ -z "$branch" ]] && continue
      if $DRY_RUN; then
        echo "  (dry-run) would delete remote: $branch"
      else
        if git push origin --delete "$branch" >/dev/null 2>&1; then
          echo "  deleted remote: $branch"
          ((total_deleted++))
        else
          echo "  skipped (already deleted?): $branch"
        fi
      fi
    done <<< "$merged_remote"
  else
    echo "  (none)"
  fi
fi

# --- Summary ---
echo ""
if $DRY_RUN; then
  echo "Dry run complete. No branches were deleted."
else
  echo "Done. Deleted $total_deleted branch(es)."
fi
