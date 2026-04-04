#!/bin/bash
# healthcheck.sh - Jupyter Server のヘルスチェックスクリプト
#
# Docker のヘルスチェック機構から呼び出され、
# Jupyter Server の稼働状態を確認する。

# 環境変数から設定を取得
JUPYTER_URL="${JUPYTER_URL:-http://localhost:8888}"
JUPYTER_TOKEN="${JUPYTER_TOKEN:-}"

# Jupyter Server のカーネル管理API確認
# /api/kernels はカーネル管理機能の稼働も確認できる
# カーネルが0個でも正常応答（空配列）を返すため問題なし
response=$(curl -sf -H "Authorization: token ${JUPYTER_TOKEN}" \
  "${JUPYTER_URL}/api/kernels" 2>/dev/null)

if [ $? -eq 0 ]; then
  exit 0
else
  exit 1
fi
