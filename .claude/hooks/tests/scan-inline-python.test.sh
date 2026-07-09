#!/bin/bash
# フック scan-inline-python.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/scan-inline-python.test.sh

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
HOOK="${PROJECT_DIR}/.claude/hooks/scan-inline-python.sh"

if [[ ! -x "$HOOK" ]]; then
  echo "ERROR: hook not found or not executable: $HOOK" >&2
  exit 1
fi

PASS=0
FAIL=0
FAILURES=()

build_input() {
  HOOK_TEST_COMMAND="$1" python3 -c '
import json, os
print(json.dumps({"tool_input": {"command": os.environ["HOOK_TEST_COMMAND"]}}))
'
}

# 通過: exit 0 かつ stdout が空であること
run_pass() {
  local desc="$1"
  local command="$2"
  local input
  input=$(build_input "$command")
  local actual_exit=0
  local output
  output=$(echo "$input" | "$HOOK" 2>/dev/null) || actual_exit=$?
  if [[ "$actual_exit" == "0" && -z "$output" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (exit=$actual_exit, output=$output)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

# ask: exit 0 かつ stdout に permissionDecision: ask の JSON が出ること
run_ask() {
  local desc="$1"
  local command="$2"
  local input
  input=$(build_input "$command")
  local actual_exit=0
  local output
  output=$(echo "$input" | "$HOOK" 2>/dev/null) || actual_exit=$?
  if [[ "$actual_exit" == "0" && "$output" == *'"permissionDecision"'* && "$output" == *'"ask"'* ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (exit=$actual_exit, output=$output)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

echo "=== scan-inline-python.sh テスト ==="
echo ""
echo "--- 通過対象（exit 0、出力なし） ---"

run_pass 'ls -la'                                       'ls -la'
run_pass 'pytest tests/'                                'pytest tests/'
run_pass 'echo "python is great"'                       'echo "python is great"'
run_pass 'uv run python script.py'                      'uv run python script.py'
run_pass 'uv run python -c 短い 1 行'                   'uv run python -c "print(1)"'
run_pass 'uv run python3 -c 短い 1 行'                  'uv run python3 -c "import sys; print(sys.version)"'
run_pass 'python -c 短い（block-direct-python が止める） ' 'python -c "print(1)"'
run_pass 'uv run python -c 2 行（閾値未満）'            "uv run python -c $'import sys\nprint(sys.version)'"

echo ""
echo "--- ask 対象（permissionDecision: ask 出力） ---"

# 3 行（閾値）
THREE_LINE_CODE=$'import os\nimport sys\nprint(1)'
run_ask '3 行のインライン Python (uv run)' "uv run python -c '$THREE_LINE_CODE'"

# 200 文字超
LONG=$(python3 -c 'print("x = 1; " * 30, end="")')
run_ask '200 文字超のインライン Python'   "uv run python -c '$LONG'"

# プロセス置換（短くても ask）
run_ask 'プロセス置換 uv run python <(...)' 'uv run python <(echo "print(1)")'
run_ask 'プロセス置換 python <(curl ...)'   'python <(curl http://example.com)'
run_ask 'プロセス置換 python3 <(...)'       'python3 <(echo "print(2)")'

# 直叩き python -c でも閾値超過は ask
FOUR_LINE_CODE=$'a = 1\nb = 2\nc = 3\nprint(a + b + c)'
run_ask '4 行の python -c 直叩き' "python -c '$FOUR_LINE_CODE'"

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
