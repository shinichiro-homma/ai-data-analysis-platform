#!/bin/bash

# tmp/ 配下のアドホックスクリプトを実行する Bash コマンドを検出し、
# スクリプト本文を危険パターンでスキャンする hook。
#
# ルール: .claude/rules/adhoc-script-execution.md
#
# 対象コマンド: node tmp/*, python3 tmp/*, python tmp/*, bash tmp/*, sh tmp/*
#
# フック応答:
#   exit 0 = 許可（対象外、または危険パターンなし）
#   JSON + exit 0 = ask（危険パターン検出、ユーザー承認を要求）

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# tmp/ 配下のスクリプトファイルパスを抽出
# 例: "node tmp/adhoc-foo.mjs" → "tmp/adhoc-foo.mjs"
# 例: "JUPYTER_TOKEN=x python3 tmp/check.py --flag" → "tmp/check.py"
SCRIPT_PATH=$(echo "$COMMAND" \
  | grep -oE '(node|python3|python|bash|sh)[[:space:]]+[^[:space:]]*tmp/[^[:space:]]+' \
  | head -1 \
  | grep -oE 'tmp/[^[:space:]]+')

if [[ -z "$SCRIPT_PATH" ]]; then
  exit 0
fi

# プロジェクトルートからの絶対パスを構築
if [[ -n "$CLAUDE_PROJECT_DIR" ]]; then
  FULL_PATH="$CLAUDE_PROJECT_DIR/$SCRIPT_PATH"
else
  FULL_PATH="$SCRIPT_PATH"
fi

if [[ ! -f "$FULL_PATH" ]]; then
  # ファイル未作成 → スキップ（Write ツールで書かれるはず）
  exit 0
fi

# 危険パターン検出
DETECTED=()

# ファイル/ディレクトリ破壊
if grep -qE '\brm[[:space:]]+-[rf]+[[:space:]]|\bfs\.(rm|rmSync|unlink|unlinkSync|rmdir)\b|\bshutil\.rmtree\b|\bos\.(remove|unlink|rmdir)\b' "$FULL_PATH"; then
  DETECTED+=("ファイル/ディレクトリ破壊（rm -rf, fs.rm*, shutil.rmtree, os.remove 等）")
fi

# 外部ダウンロード実行
if grep -qE '(curl|wget)[^|]*\|[[:space:]]*(sh|bash|zsh)' "$FULL_PATH"; then
  DETECTED+=("外部ダウンロード実行（curl|sh, wget|bash）")
fi

# 任意コード実行
if grep -qE '\bchild_process\.(exec|execSync|spawn)\b|\bsubprocess\.[^(]*\([^)]*shell[[:space:]]*=[[:space:]]*True|\bos\.system\b|\beval\s*\(' "$FULL_PATH"; then
  DETECTED+=("任意コード実行（child_process.exec, subprocess(shell=True), os.system, eval）")
fi

# 権限昇格
if grep -qE '\bsudo\b|\bchmod[[:space:]]+777\b' "$FULL_PATH"; then
  DETECTED+=("権限昇格（sudo, chmod 777）")
fi

# 外向き通信（localhost/ローカルサービス以外のホスト）
# 許可: localhost, 127.0.0.1, jupyter-server, document-server, postgres, jupyter-mcp, document-mcp
EXTERNAL_URLS=$(grep -oE 'https?://[A-Za-z0-9._-]+' "$FULL_PATH" \
  | grep -vE 'https?://(localhost|127\.0\.0\.1|jupyter-server|document-server|postgres|jupyter-mcp|document-mcp)(:[0-9]+)?' \
  | sort -u)
if [[ -n "$EXTERNAL_URLS" ]]; then
  DETECTED+=("許可リスト外の外向き通信: $(echo "$EXTERNAL_URLS" | tr '\n' ' ')")
fi

if [[ ${#DETECTED[@]} -eq 0 ]]; then
  exit 0
fi

# 検出内容を連結
REASONS=$(printf '%s; ' "${DETECTED[@]}")
MESSAGE="tmp/ スクリプト '${SCRIPT_PATH}' に禁止パターンが検出されました: ${REASONS}詳細は .claude/rules/adhoc-script-execution.md を参照してください。"

# jq で JSON をエスケープして出力
jq -n --arg reason "$MESSAGE" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: $reason
  }
}'
exit 0
