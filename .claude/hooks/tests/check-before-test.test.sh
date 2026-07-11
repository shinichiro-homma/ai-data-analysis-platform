#!/bin/bash
# フック check-before-test.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/check-before-test.test.sh
#
# 鮮度チェックの実体（scripts/check-freshness.sh）はスタブに差し替え、
# CLAUDE_PROJECT_DIR をスタブ入りの一時ディレクトリに向けて検証する。

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
HOOK="${PROJECT_DIR}/.claude/hooks/check-before-test.sh"

if [[ ! -x "$HOOK" ]]; then
  echo "ERROR: hook not found or not executable: $HOOK" >&2
  exit 1
fi

# ── スタブ環境の準備 ──
# stale 環境: check-freshness.sh --strict が exit 1 を返す
STALE_DIR=$(mktemp -d)
mkdir -p "$STALE_DIR/scripts"
printf '#!/bin/bash\necho "stub: STALE"\nexit 1\n' > "$STALE_DIR/scripts/check-freshness.sh"
chmod +x "$STALE_DIR/scripts/check-freshness.sh"

# fresh 環境: check-freshness.sh --strict が exit 0 を返す
FRESH_DIR=$(mktemp -d)
mkdir -p "$FRESH_DIR/scripts"
printf '#!/bin/bash\necho "stub: OK"\nexit 0\n' > "$FRESH_DIR/scripts/check-freshness.sh"
chmod +x "$FRESH_DIR/scripts/check-freshness.sh"

cleanup() {
  rm -rf "$STALE_DIR" "$FRESH_DIR"
}
trap cleanup EXIT

PASS=0
FAIL=0
FAILURES=()

run_test() {
  local desc="$1"
  local command="$2"
  local project_dir="$3"
  local expected_exit="$4"

  local input
  input=$(HOOK_TEST_COMMAND="$command" python3 -c '
import json, os
print(json.dumps({"tool_input": {"command": os.environ["HOOK_TEST_COMMAND"]}}))
')

  local actual_exit=0
  echo "$input" | CLAUDE_PROJECT_DIR="$project_dir" "$HOOK" >/dev/null 2>&1 || actual_exit=$?

  if [[ "$actual_exit" == "$expected_exit" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected exit $expected_exit, got $actual_exit)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

echo "=== check-before-test.sh テスト ==="
echo ""
echo "--- ゲート対象外（stale 環境でも exit 0 期待） ---"

run_test 'テスト以外のコマンドは対象外'                    'git status'                                                        "$STALE_DIR" 0
run_test 'ユニットテスト（--integration なし）はスキップ'   'scripts/test.sh --quiet jupyter-mcp'                                "$STALE_DIR" 0
run_test 'スコープ実行もスキップ'                          'scripts/test.sh --quiet --test --no-lint jupyter-mcp -- tests/unit/utils/errors.test.ts' "$STALE_DIR" 0
run_test 'hooks コンポーネントのテストはスキップ'           'scripts/test.sh hooks'                                              "$STALE_DIR" 0
run_test '--integration --rebuild は自前対処なのでスキップ' 'scripts/test.sh --integration --rebuild jupyter-mcp'                "$STALE_DIR" 0
run_test '--rebuild 付き test.sh はスキップ'                'scripts/test.sh --rebuild jupyter-mcp'                              "$STALE_DIR" 0

echo ""
echo "--- ゲート対象・環境が古い（exit 2 期待） ---"

run_test '統合テストは stale 環境でブロック'               'scripts/test.sh --integration jupyter-mcp'                          "$STALE_DIR" 2
run_test 'スモークテストは stale 環境でブロック'           'scripts/smoke-test.sh'                                              "$STALE_DIR" 2

echo ""
echo "--- ゲート対象・環境が新しい（exit 0 期待） ---"

run_test '統合テストは fresh 環境で通過'                   'scripts/test.sh --integration jupyter-mcp'                          "$FRESH_DIR" 0
run_test 'スモークテストは fresh 環境で通過'               'scripts/smoke-test.sh'                                              "$FRESH_DIR" 0

echo ""
echo "=== 結果 ==="
echo "PASS: $PASS, FAIL: $FAIL"

if [[ $FAIL -gt 0 ]]; then
  echo "失敗ケース:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

echo "全テスト PASS"
