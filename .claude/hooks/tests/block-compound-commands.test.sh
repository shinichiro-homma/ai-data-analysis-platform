#!/bin/bash
# フック block-compound-commands.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/block-compound-commands.test.sh

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
HOOK="${PROJECT_DIR}/.claude/hooks/block-compound-commands.sh"

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

  # 入力 JSON は python3 で組み立てる（jq 未インストール環境でもテストを回すため）
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

echo "=== block-compound-commands.sh テスト ==="
echo ""
echo "--- ブロック対象（exit 2 期待） ---"

run_test 'git add -A && git commit -m x'            'git add -A && git commit -m x'            2
run_test 'ls | head'                                 'ls | head'                                 2
run_test 'echo a; echo b'                            'echo a; echo b'                            2
run_test 'sleep 5 &'                                 'sleep 5 &'                                 2
run_test 'a || b'                                    'a || b'                                    2
run_test 'echo hi && python3 -c "print(1)"'          'echo hi && python3 -c "print(1)"'          2
run_test '(cd /tmp && python3 x.py)'                 '(cd /tmp && python3 x.py)'                 2

echo ""
echo "--- 通過対象（exit 0 期待） ---"

run_test 'echo "a && b"'                             'echo "a && b"'                             0
run_test "echo 'x | y; z'"                            "echo 'x | y; z'"                            0
run_test 'node x.js > out.log 2>&1'                  'node x.js > out.log 2>&1'                  0
run_test 'git commit -F tmp/commit-msg.txt'          'git commit -F tmp/commit-msg.txt'          0
run_test 'npm run build --workspace=jupyter-mcp'     'npm run build --workspace=jupyter-mcp'     0

# heredoc 本文に && を含むが、コマンド行自体には演算子がないケース
HEREDOC_CMD=$'cat > /dev/null <<EOF\na && b\nEOF'
run_test 'heredoc 本文内の && は無視される' "$HEREDOC_CMD" 0

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
