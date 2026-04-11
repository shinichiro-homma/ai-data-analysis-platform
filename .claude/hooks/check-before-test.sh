#!/bin/bash

# テスト実行前に環境の鮮度をチェックし、古い場合はブロックする hook
#
# 対象: scripts/test.sh, scripts/smoke-test.sh
# 例外: --rebuild フラグ付き（自前でリビルドするため）

# shellcheck source=lib/json.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

INPUT=$(cat)
COMMAND=$(json_get_path "$INPUT" .tool_input.command)

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# テスト関連コマンドを検出
# - scripts/test.sh, scripts/smoke-test.sh にマッチ
# - scripts/rebuild.sh, scripts/check-freshness.sh にはマッチしない
if ! echo "$COMMAND" | grep -qE 'scripts/(test|smoke-test)\.sh'; then
  exit 0
fi

# --rebuild フラグ付きは自前で対処するのでスキップ
if echo "$COMMAND" | grep -q -- '--rebuild'; then
  exit 0
fi

# プロジェクトディレクトリに移動
cd "$CLAUDE_PROJECT_DIR" || exit 0

# 鮮度チェック（--strict: 古い場合は exit 1）
FRESHNESS_OUTPUT=$(scripts/check-freshness.sh --strict 2>&1) || {
  cat >&2 <<EOF
========================================
 BLOCKED: 環境が古いためテストを実行できません
========================================

$FRESHNESS_OUTPUT

テスト前に古いコンポーネントをリビルドしてください:

  # MCP サーバーが古い場合
  scripts/rebuild-mcp.sh

  # Docker コンテナが古い場合
  scripts/rebuild.sh

  # postgres (init) が古い場合 — カタログ YAML の変更を反映
  scripts/generate-init-scripts.sh {ENV}

  # postgres (data) が古い場合 — DB を再初期化
  scripts/switch-env.sh {ENV}

  # または --rebuild フラグ付きで自動対処
  scripts/test.sh --integration --rebuild
========================================
EOF
  exit 2
}

exit 0
