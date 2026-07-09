#!/bin/bash
# フック prefer-commit-file.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/prefer-commit-file.test.sh

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
HOOK="${PROJECT_DIR}/.claude/hooks/prefer-commit-file.sh"

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

echo "=== prefer-commit-file.sh テスト ==="
echo ""
echo "--- ブロック対象（exit 2 期待） ---"

run_test 'git commit -m "feat: x"'    'git commit -m "feat: x"'    2
run_test 'git commit -am "x"'          'git commit -am "x"'          2
run_test 'git commit（引数なし）'       'git commit'                  2

echo ""
echo "--- 通過対象（exit 0 期待） ---"

run_test 'git commit -F tmp/commit-msg.txt'          'git commit -F tmp/commit-msg.txt'          0
run_test 'git commit -a -F tmp/commit-msg.txt'       'git commit -a -F tmp/commit-msg.txt'       0
run_test 'git commit --amend --no-edit'              'git commit --amend --no-edit'              0
run_test 'git status'                                 'git status'                                 0
run_test 'echo "git commit -m hi"（先頭一致でない）'  'echo "git commit -m hi"'                  0

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
