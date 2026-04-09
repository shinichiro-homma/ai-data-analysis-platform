#!/bin/bash

# パイプ・チェーンで繋がれたコマンドを分解し、
# 各コマンドが settings.json / settings.local.json の許可リストに含まれていれば自動許可する hook
#
# サブシェル $() の扱い:
#   - ネストした $() やバッククォート → 安全側に倒してスキップ
#   - 単純な $() → 中身を取り出して許可リストと照合
#   - 変数代入 VAR=$(...) → 代入自体は安全、$() 内のコマンドを検証
#   - 変数参照 $VAR, "$VAR" → コマンド実行ではないのでスキップ
#
# 単体コマンド（パイプなし・サブシェルなし）は対象外 — Claude Code の通常の権限チェックに委ねる
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

# バッククォートは安全側に倒してスキップ
if echo "$COMMAND" | grep -q '`'; then
  exit 0
fi

# ネストした $() は安全側に倒してスキップ
# 例: $(cmd1 $(cmd2)) — $( の後に ) が来る前に再度 $( が出現するパターン
if echo "$COMMAND" | grep -qE '\$\([^)]*\$\('; then
  exit 0
fi

# パイプ・チェーン演算子も $() も含まない単体コマンドはスキップ
# （Claude Code の allow list で処理される）
if ! echo "$COMMAND" | grep -qE '\||\&\&|;|\$\('; then
  exit 0
fi

# settings.json と settings.local.json の両方から Bash の許可プレフィックスを動的に取得
SETTINGS_FILES=()
for f in "${CLAUDE_PROJECT_DIR}/.claude/settings.json" "${CLAUDE_PROJECT_DIR}/.claude/settings.local.json"; do
  [[ -f "$f" ]] && SETTINGS_FILES+=("$f")
done

if [[ ${#SETTINGS_FILES[@]} -eq 0 ]]; then
  exit 0
fi

# 複数ファイルから Bash(...) パターンのプレフィックスを抽出・統合
# "Bash(git status:*)" → "git status"
# "Bash(scripts/*)" → "scripts/"
# "Read", "Write" など Bash 以外はスキップ
extract_prefixes() {
  local jq_path="$1"
  for f in "${SETTINGS_FILES[@]}"; do
    jq -r "${jq_path}[]? // empty" "$f" 2>/dev/null
  done | grep '^Bash(' \
       | sed 's/^Bash(//; s/[:*]*)*$//' \
       | sort -u
}

IFS=$'\n' read -r -d '' -a ALLOWED_PREFIXES < <(
  extract_prefixes '.permissions.allow'
  printf '\0'
)

# deny リストからブロック対象のプレフィックスも取得
IFS=$'\n' read -r -d '' -a DENIED_PREFIXES < <(
  extract_prefixes '.permissions.deny'
  printf '\0'
)

# ask リストから確認対象のプレフィックスも取得
IFS=$'\n' read -r -d '' -a ASK_PREFIXES < <(
  extract_prefixes '.permissions.ask'
  printf '\0'
)

if [[ ${#ALLOWED_PREFIXES[@]} -eq 0 ]]; then
  exit 0
fi

# コマンド片を deny/ask/allow リストと照合する関数
# 戻り値: 0=許可, 1=deny/ask に該当, 2=allow にマッチしない
check_command_part() {
  local part="$1"

  for PREFIX in "${DENIED_PREFIXES[@]}"; do
    [[ "$part" == "$PREFIX"* ]] && return 1
  done

  for PREFIX in "${ASK_PREFIXES[@]}"; do
    [[ "$part" == "$PREFIX"* ]] && return 1
  done

  for PREFIX in "${ALLOWED_PREFIXES[@]}"; do
    [[ "$part" == "$PREFIX"* ]] && return 0
  done

  return 2
}

# $() 内のコマンドを検証する
# $() を含む場合、中身を取り出してパイプ/チェーンで分割し、各コマンドを照合する
if echo "$COMMAND" | grep -qE '\$\('; then
  # $(...) の中身を抽出（複数の $() に対応）
  SUBSHELL_CONTENTS=$(echo "$COMMAND" | grep -oE '\$\([^)]+\)' | sed 's/^\$(//' | sed 's/)$//')

  if [[ -n "$SUBSHELL_CONTENTS" ]]; then
    while IFS= read -r SUBCMD; do
      # サブシェル内もパイプ/チェーンで分割
      IFS=$'\n' read -r -d '' -a SUB_PARTS < <(
        echo "$SUBCMD" | sed 's/\s*|\s*/\n/g; s/\s*&&\s*/\n/g; s/\s*;\s*/\n/g'
        printf '\0'
      )

      for SUB_PART in "${SUB_PARTS[@]}"; do
        SUB_PART=$(echo "$SUB_PART" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        [[ -z "$SUB_PART" ]] && continue

        check_command_part "$SUB_PART"
        [[ $? -ne 0 ]] && exit 0
      done
    done <<< "$SUBSHELL_CONTENTS"
  fi
fi

# メインコマンドの解析用に $() と $VAR をプレースホルダに置換
CLEANED="$COMMAND"
# $(...) → __SUBSHELL__ に置換
CLEANED=$(echo "$CLEANED" | sed 's/\$([^)]*)/__SUBSHELL__/g')
# "$VAR" → __VAR__ に置換（ダブルクォート付き変数参照）
CLEANED=$(echo "$CLEANED" | sed 's/"\$[A-Za-z_][A-Za-z_0-9]*"/__VAR__/g')
# $VAR → __VAR__ に置換（クォートなし変数参照）
CLEANED=$(echo "$CLEANED" | sed 's/\$[A-Za-z_][A-Za-z_0-9]*/__VAR__/g')

# コマンドを |, &&, ; で分割して配列に格納
IFS=$'\n' read -r -d '' -a PARTS < <(
  echo "$CLEANED" | sed 's/\s*|\s*/\n/g; s/\s*&&\s*/\n/g; s/\s*;\s*/\n/g'
  printf '\0'
)

for PART in "${PARTS[@]}"; do
  # 前後の空白を除去
  PART=$(echo "$PART" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

  if [[ -z "$PART" ]]; then
    continue
  fi

  # 変数代入パターン: VAR=value (コマンドなし) → 安全、スキップ
  # 例: BRANCH=__SUBSHELL__ → 代入のみ、実行コマンドなし
  if echo "$PART" | grep -qE '^[A-Za-z_][A-Za-z_0-9]*='; then
    # 代入部分 (VAR=value) を除去して残りがあるか確認
    AFTER_ASSIGN=$(echo "$PART" | sed 's/^[A-Za-z_][A-Za-z_0-9]*=[^ ]* *//')
    if [[ -z "$AFTER_ASSIGN" ]]; then
      continue  # 純粋な代入、コマンド実行なし
    fi
    # VAR=value command args → command 部分を検証
    PART="$AFTER_ASSIGN"
  fi

  check_command_part "$PART"
  [[ $? -ne 0 ]] && exit 0
done

# 全パーツが許可済み → 明示的に許可を返す
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"All commands in pipe are in the allowed list"}}
EOF
exit 0
