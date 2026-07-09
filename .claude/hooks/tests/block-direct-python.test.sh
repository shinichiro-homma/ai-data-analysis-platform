#!/bin/bash
# フック block-direct-python.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/block-direct-python.test.sh
#
# 新実装（先頭トークン判定）に伴い、複合コマンドのケース
# （echo hi && python3 ... 等）は block-compound-commands.sh の
# 責務に移管したため、このテストからは除外する。

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
run_test 'python script.py'                          'python script.py'                          2
run_test 'pip install foo'                            'pip install foo'                            2
run_test 'pip3 install x'                             'pip3 install x'                             2
run_test '/usr/bin/python3 x.py'                      '/usr/bin/python3 x.py'                      2
run_test '.venv/bin/python x.py'                      '.venv/bin/python x.py'                      2
run_test 'PYTHONPATH=. python x.py'                   'PYTHONPATH=. python x.py'                   2
run_test '  python3 x.py（先頭空白）'                  '  python3 x.py'                             2

echo ""
echo "--- 通過対象（exit 0 期待） ---"

run_test 'uv run python -c "print(1)"'              'uv run python -c "print(1)"'              0
run_test 'uv run pip install foo'                   'uv run pip install foo'                   0
run_test 'uv sync'                                   'uv sync'                                   0
run_test 'uv add --dev foo'                          'uv add --dev foo'                          0
run_test 'pytest tests/'                            'pytest tests/'                            0
run_test 'mypy src/'                                'mypy src/'                                0
run_test 'ruff check src/'                          'ruff check src/'                          0
run_test 'ipython'                                  'ipython'                                  0
run_test 'echo "use python3 -c for this"（旧誤検知ケース）' 'echo "use python3 -c for this"'      0
run_test 'grep -r "python3 -c" docs/'               'grep -r "python3 -c" docs/'               0
run_test '# python3 -c "x"'                          '# python3 -c "x"'                          0

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
