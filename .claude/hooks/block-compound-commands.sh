#!/bin/bash

# 複合コマンド（パイプ・チェーン）を検出してブロックする PreToolUse hook。
#
# 方針: Claude は常に「単一コマンド」を実行する。
#   |  &&  ||  ;  &  で複数コマンドを繋ぐことを禁止し、
#   それぞれ別の Bash 呼び出しに分割させる。
#   → settings.json の許可リスト（単一コマンドのプレフィックス）が素直に効き、
#     パイプを分解して照合する脆いロジックが不要になる。
#   → 下流の hook（block-direct-python.sh 等）が「コマンド先頭」だけを
#     検査すればよくなり、文字列内のパターンを誤検知しなくなる。
#
# 演算子の判定は「シェル演算子」のみを対象とする。文字列リテラル・
# heredoc 本文・redirect(2>&1 等)に含まれる | & ; は誤検出しない:
#   1. heredoc 本文（<<EOF ... EOF）を除去（コマンド行は残す）
#   2. バックスラッシュエスケープ（\;  \&  \|  ...）を除去
#   3. シングル/ダブルクォートで囲まれた範囲を除去
#   4. redirect の fd 指定（2>&1, >&2, &>）を除去
#   その後に残る |  &  ; をシェル演算子とみなす。
#
# ルール: .claude/rules/general.md「Bash は単一コマンドで実行する」
#
# フック応答:
#   exit 0 = 許可（単一コマンド）
#   exit 2 = ブロック（stderr の指示に従って Claude が分割）

# shellcheck source=lib/json.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

INPUT=$(cat)
COMMAND=$(json_get_path "$INPUT" .tool_input.command)

[[ -z "$COMMAND" ]] && exit 0

# --- シェル演算子だけを残すための前処理 ---

# 1. heredoc 本文を除去（コマンド行は残す。本文中の | & ; を誤検出しない）
STRIPPED=$(printf '%s\n' "$COMMAND" | awk '
  BEGIN { inhd = 0; delim = "" }
  {
    if (inhd) {
      if ($0 ~ "^[[:space:]]*" delim "[[:space:]]*$") inhd = 0
      next
    }
    if (match($0, /<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*/)) {
      d = substr($0, RSTART, RLENGTH)
      sub(/<<-?[[:space:]]*["'"'"']?/, "", d)
      delim = d
      inhd = 1
    }
    print
  }
')

# 2. エスケープ文字を除去（\;  \&  \|  \"  ...）
STRIPPED=$(printf '%s' "$STRIPPED" | sed 's/\\.//g')
# 3. クォート範囲を除去（シングル → ダブルの順）
STRIPPED=$(printf '%s' "$STRIPPED" | sed "s/'[^']*'//g")
STRIPPED=$(printf '%s' "$STRIPPED" | sed 's/"[^"]*"//g')
# 4. redirect の fd 指定を除去（2>&1, >&2, &>file の & を演算子と誤認しない）
STRIPPED=$(printf '%s' "$STRIPPED" | sed -E 's/[0-9]*>&[0-9-]*//g; s/&>>?//g')

# 残った | & ; はシェル演算子 → 複合コマンドとしてブロック
if printf '%s' "$STRIPPED" | grep -qE '[|&;]'; then
  cat >&2 <<'EOF'
========================================
 BLOCKED: 複合コマンド（パイプ・チェーン）は禁止されています
========================================

|  &&  ||  ;  &  で複数コマンドを繋がず、
それぞれ別の Bash 呼び出しに分割して実行してください。

  NG: git add -A && git commit -F tmp/commit-msg.txt
  OK: （1回目）git add -A
      （2回目）git commit -F tmp/commit-msg.txt

  NG: docker logs jupyter-server | tail -50
  OK: docker logs --tail 50 jupyter-server
      （絞り込み・検索は Grep / Read ツールを使う）

複数ステップの定型処理は scripts/ 配下のスクリプトを使ってください
（.claude/rules/scripts.md 参照）。

理由: 各 Bash 呼び出しを単一コマンドに統一することで、
許可リストによる制御を確実にするためです。
========================================
EOF
  exit 2
fi

exit 0
