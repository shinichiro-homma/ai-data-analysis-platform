#!/bin/bash
# フック prefer-canonical-command.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/prefer-canonical-command.test.sh

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
HOOK="${PROJECT_DIR}/.claude/hooks/prefer-canonical-command.sh"

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

echo "=== prefer-canonical-command.sh テスト ==="
echo ""
echo "--- ブロック対象（exit 2 期待） ---"

run_test 'git -C /path/to/repo add -A'   'git -C /path/to/repo add -A'   2
run_test 'git -C=/x status'               'git -C=/x status'               2

echo ""
echo "--- 通過対象（exit 0 期待） ---"

run_test 'git add -A'         'git add -A'         0
run_test 'git status'          'git status'          0
run_test 'echo git -C /x'      'echo git -C /x'      0

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
