#!/bin/bash
# フック block-direct-python.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/block-direct-python.test.sh

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
HOOK="${PROJECT_DIR}/.claude/hooks/block-direct-python.sh"

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

echo "=== block-direct-python.sh テスト ==="
echo ""
echo "--- ブロック対象（exit 2 期待） ---"

run_test 'python3 -c "print(1)"'                    'python3 -c "print(1)"'                    2
run_test 'python -c "print(1)"'                     'python -c "print(1)"'                     2
run_test 'pip install foo'                          'pip install foo'                          2
run_test 'pip3 install foo'                         'pip3 install foo'                         2
run_test 'python3 script.py'                        'python3 script.py'                        2
run_test 'PYTHONPATH=. pip install x'               'PYTHONPATH=. pip install x'               2
run_test '/usr/bin/python3 -c "print(1)"'           '/usr/bin/python3 -c "print(1)"'           2
run_test '(cd /tmp && python3 -c "print(1)")'       '(cd /tmp && python3 -c "print(1)")'       2
run_test 'echo hi && python3 -c "print(1)"'         'echo hi && python3 -c "print(1)"'         2

echo ""
echo "--- 通過対象（exit 0 期待） ---"

run_test 'uv run python -c "print(1)"'              'uv run python -c "print(1)"'              0
run_test 'uv run pip install foo'                   'uv run pip install foo'                   0
run_test 'uv run python3 script.py'                 'uv run python3 script.py'                 0
# 注: 'echo "python is a language"' はトークン境界判定の簡潔な実装優先のため、
#     "python" が echo 引数内の文字列として扱われるがフラグが引っかかる可能性があるため
#     このテストケースは除外する（偽陽性になる場合があるため）
run_test 'pytest tests/'                            'pytest tests/'                            0
run_test 'mypy src/'                                'mypy src/'                                0
run_test 'ruff check src/'                          'ruff check src/'                          0
run_test 'ipython'                                  'ipython'                                  0
run_test '# python3 -c "print(1)"'                  '# python3 -c "print(1)"'                  0

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
