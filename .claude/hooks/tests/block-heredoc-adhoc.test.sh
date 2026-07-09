#!/bin/bash
# フック block-heredoc-adhoc.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/block-heredoc-adhoc.test.sh
#
# git commit の heredoc 例外は廃止された（prefer-commit-file.sh が -F 方式へ
# 誘導するため）。git commit -F- <<'MSG' ... のようなケースも今はブロック対象。

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
HOOK="${PROJECT_DIR}/.claude/hooks/block-heredoc-adhoc.sh"

if [[ ! -x "$HOOK" ]]; then
  echo "ERROR: hook not found or not executable: $HOOK" >&2
  exit 1
fi

PASS=0
FAIL=0
FAILURES=()

run_test() {
  local desc="$1"
  local command="$2"
  local expected_exit="$3"

  local input
  input=$(HOOK_TEST_COMMAND="$command" python3 -c '
import json, os
print(json.dumps({"tool_input": {"command": os.environ["HOOK_TEST_COMMAND"]}}))
')

  local actual_exit=0
  echo "$input" | "$HOOK" >/dev/null 2>&1 || actual_exit=$?

  if [[ "$actual_exit" == "$expected_exit" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected exit $expected_exit, got $actual_exit)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

echo "=== block-heredoc-adhoc.sh テスト ==="
echo ""
echo "--- ブロック対象（exit 2 期待） ---"

NODE_HEREDOC=$'node <<\'EOF\'\nconsole.log(1)\nEOF'
run_test 'node heredoc' "$NODE_HEREDOC" 2

BASH_HEREDOC=$'bash <<EOF\necho hi\nEOF'
run_test 'bash heredoc' "$BASH_HEREDOC" 2

GIT_COMMIT_HEREDOC=$'git commit -F- <<\'MSG\'\nfeat: x\nMSG'
run_test 'git commit -F- heredoc（例外廃止、ブロックされる）' "$GIT_COMMIT_HEREDOC" 2

echo ""
echo "--- 通過対象（exit 0 期待） ---"

run_test 'echo hello'                 'echo hello'                 0
run_test 'uv run python tmp/x.py'     'uv run python tmp/x.py'     0
run_test 'cat file.txt'                'cat file.txt'                0

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
