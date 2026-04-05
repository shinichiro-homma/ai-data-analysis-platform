#!/bin/bash

# Bash コマンド内のヒアドキュメント（<< EOF 等）を検出し、
# アドホックスクリプト実行を tmp/ ファイル経由に誘導する hook。
#
# ルール: .claude/rules/adhoc-script-execution.md
#
# フック応答:
#   exit 0 = 許可（heredoc なし、または対象外）
#   exit 2 = ブロック（stderr の指示に従って Claude が自己修正）

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# ヒアドキュメントのパターンを検出
# << EOF, << 'EOF', <<-EOF, <<"EOF" など
if ! echo "$COMMAND" | grep -qE '<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*'; then
  exit 0
fi

# git commit のヒアドキュメント（CLAUDE.md で推奨されている形式）は例外
if echo "$COMMAND" | grep -qE '^[[:space:]]*git[[:space:]]+commit'; then
  exit 0
fi

# それ以外の heredoc はブロックし、修正手順を Claude に返す
cat >&2 <<'EOF'
========================================
 BLOCKED: ヒアドキュメントを使ったアドホック実行は禁止されています
========================================

以下の 2 ステップに書き直して再実行してください:

1. Write ツールで tmp/adhoc-{用途}.{mjs|py|sh} にスクリプトを保存する
   - ファイル名例: tmp/adhoc-session-test.mjs
   - 必要なら先に tmp/ ディレクトリを mkdir で作成する

2. 単一コマンドで実行する（環境変数は前置で OK）
   例: JUPYTER_TOKEN=dev-token node tmp/adhoc-session-test.mjs

使い終わった tmp/ スクリプトは削除してください。
tmp/ は .gitignore 済みなのでコミットされません。

例外: git commit のヒアドキュメントのみ許可されています。
gh pr create / gh issue create の本文は tmp/ ファイルに書き出し、
--body-file tmp/pr-body.md で渡してください。

詳細: .claude/rules/adhoc-script-execution.md
========================================
EOF
exit 2
