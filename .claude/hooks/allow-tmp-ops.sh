#!/bin/bash

# tmp/ 配下のみを対象とするファイル操作コマンドを自動許可する PreToolUse hook
#
# tmp/ は一時ファイル用（.gitignore 済み）なので、permissions.ask に該当する
# コマンド（rm -rf 等）でも確認なしで実行を許可する。
#
# 判定（すべて満たす場合のみ許可）:
#   1. 単一コマンドである（複合コマンドは block-compound-commands.sh が上流でブロック）
#   2. コマンドがファイル操作 verb（rm / mv / cp / mkdir / touch / chmod）で始まる
#   3. フラグ・chmod モード以外の全引数が tmp/ 配下のパスである
#      （tmp/ 以外のパスが 1 つでも含まれればデフォルト判定に委ねる）
#
# クォート・変数展開・グロブを含む複雑なコマンドは判定せずデフォルトに委ねる
# （安全側に倒す）。
#
# フック応答:
#   JSON + exit 0 = 許可（tmp/ のみ対象）
#   出力なし + exit 0 = デフォルト動作に委ねる

# shellcheck source=lib/json.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

INPUT=$(cat)
COMMAND=$(json_get_path "$INPUT" .tool_input.command)

[[ -z "$COMMAND" ]] && exit 0

# 複合コマンドは対象外（block-compound-commands.sh が上流でブロックする）
printf '%s' "$COMMAND" | grep -qE '[|&;]' && exit 0

# クォート・変数展開・コマンド置換・グロブ・チルダを含む場合は対象外（安全側）
case "$COMMAND" in
  *'"'* | *"'"* | *'$'* | *'`'* | *'*'* | *'?'* | *'~'* | *'<'* | *'>'*) exit 0 ;;
esac

read -r -a TOKENS <<<"$COMMAND"
VERB="${TOKENS[0]:-}"

case "$VERB" in
  rm | mv | cp | mkdir | touch | chmod) ;;
  *) exit 0 ;;
esac

HAS_TMP_PATH=0
for tok in "${TOKENS[@]:1}"; do
  # フラグ（-rf, --force 等）はスキップ
  [[ "$tok" == -* ]] && continue
  # chmod のモード引数（755, +x, u+rwX 等）はスキップ
  if [[ "$VERB" == "chmod" ]] && [[ "$tok" =~ ^([ugoa]*[+=-][rwxXst]+|[0-7]{3,4})$ ]]; then
    continue
  fi
  # tmp/ 配下のパスのみ許容
  if [[ "$tok" == tmp/* || "$tok" == ./tmp/* || "$tok" == tmp ]]; then
    HAS_TMP_PATH=1
  else
    # tmp/ 以外のパスを含む → 自動許可しない（デフォルト判定に委ねる）
    exit 0
  fi
done

[[ "$HAS_TMP_PATH" -eq 1 ]] || exit 0

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Command targets only tmp/ (auto-allowed)"}}
EOF
exit 0
