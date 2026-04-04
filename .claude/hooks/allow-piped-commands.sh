#!/bin/bash

# パイプ・チェーンで繋がれたコマンドを分解し、
# 各コマンドが settings.local.json の許可リストに含まれていれば自動許可する hook
#
# 単体コマンド（パイプなし）は対象外 — Claude Code の通常の権限チェックに委ねる
#
# フック応答:
#   JSON出力 + exit 0 = 明示的な許可/拒否
#   出力なし + exit 0 = 許可（デフォルト動作に委ねる）
#   exit 2 = ブロック

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# パイプ・チェーン演算子を含まない単体コマンドはスキップ
# （Claude Code の allow list で処理される）
if ! echo "$COMMAND" | grep -qE '\||\&\&|;'; then
  exit 0
fi

# サブシェル $() やバッククォートは分割対象外（安全側に倒す）
if echo "$COMMAND" | grep -qE '\$\(|`'; then
  exit 0
fi

# settings.local.json から Bash の許可プレフィックスを動的に取得
SETTINGS_FILE="${CLAUDE_PROJECT_DIR}/.claude/settings.local.json"
if [[ ! -f "$SETTINGS_FILE" ]]; then
  exit 0
fi

# Bash(...) パターンからプレフィックスを抽出
# "Bash(git status:*)" → "git status"
# "Bash(scripts/*)" → "scripts/"
# "Read", "Write" など Bash 以外はスキップ
IFS=$'\n' read -r -d '' -a ALLOWED_PREFIXES < <(
  jq -r '.permissions.allow[]? // empty' "$SETTINGS_FILE" \
    | grep '^Bash(' \
    | sed 's/^Bash(//; s/[:*]*)*$//' \
    | sort -u
  printf '\0'
)

# deny リストからブロック対象のプレフィックスも取得
IFS=$'\n' read -r -d '' -a DENIED_PREFIXES < <(
  jq -r '.permissions.deny[]? // empty' "$SETTINGS_FILE" \
    | grep '^Bash(' \
    | sed 's/^Bash(//; s/[:*]*)*$//' \
    | sort -u
  printf '\0'
)

# ask リストから確認対象のプレフィックスも取得
IFS=$'\n' read -r -d '' -a ASK_PREFIXES < <(
  jq -r '.permissions.ask[]? // empty' "$SETTINGS_FILE" \
    | grep '^Bash(' \
    | sed 's/^Bash(//; s/[:*]*)*$//' \
    | sort -u
  printf '\0'
)

if [[ ${#ALLOWED_PREFIXES[@]} -eq 0 ]]; then
  exit 0
fi

# コマンドを |, &&, ; で分割して配列に格納
IFS=$'\n' read -r -d '' -a PARTS < <(
  echo "$COMMAND" | sed 's/\s*|\s*/\n/g; s/\s*&&\s*/\n/g; s/\s*;\s*/\n/g'
  printf '\0'
)

for PART in "${PARTS[@]}"; do
  # 前後の空白を除去
  PART=$(echo "$PART" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

  if [[ -z "$PART" ]]; then
    continue
  fi

  # deny リストに該当する場合 → デフォルト動作に委ねる
  for PREFIX in "${DENIED_PREFIXES[@]}"; do
    if [[ "$PART" == "$PREFIX"* ]]; then
      exit 0
    fi
  done

  # ask リストに該当する場合 → デフォルト動作に委ねる
  for PREFIX in "${ASK_PREFIXES[@]}"; do
    if [[ "$PART" == "$PREFIX"* ]]; then
      exit 0
    fi
  done

  # allow リストでマッチするかチェック
  MATCHED=false
  for PREFIX in "${ALLOWED_PREFIXES[@]}"; do
    if [[ "$PART" == "$PREFIX"* ]]; then
      MATCHED=true
      break
    fi
  done

  if [[ "$MATCHED" == false ]]; then
    # 未許可コマンドが含まれる → Claude Code のデフォルト動作に委ねる
    exit 0
  fi
done

# 全パーツが許可済み → 明示的に許可を返す
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"All commands in pipe are in the allowed list"}}
EOF
exit 0
