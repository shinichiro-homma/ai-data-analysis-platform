#!/bin/bash
# フック allow-tmp-ops.sh のテストスクリプト
# 実行: bash .claude/hooks/tests/allow-tmp-ops.test.sh
#
# このフックは exit code ではなく stdout の JSON（permissionDecision）で
# 判定結果を表現するため、stdout の内容を検証する。

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
HOOK="${PROJECT_DIR}/.claude/hooks/allow-tmp-ops.sh"

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

# allow: exit 0 かつ stdout に permissionDecision: allow の JSON が出ること
run_allow() {
  local desc="$1"
  local command="$2"
  local input
  input=$(build_input "$command")
  local actual_exit=0
  local output
  output=$(echo "$input" | "$HOOK" 2>/dev/null) || actual_exit=$?
  if [[ "$actual_exit" == "0" && "$output" == *'"permissionDecision"'* && "$output" == *'"allow"'* ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (exit=$actual_exit, output=$output)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

# defer: exit 0 かつ stdout が空であること（デフォルト判定に委ねる）
run_defer() {
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

echo "=== allow-tmp-ops.sh テスト ==="
echo ""
echo "--- allow 対象（permissionDecision: allow 出力） ---"

run_allow 'rm -rf tmp/foo'          'rm -rf tmp/foo'
run_allow 'rm tmp/commit-msg.txt'   'rm tmp/commit-msg.txt'
run_allow 'mkdir -p tmp'            'mkdir -p tmp'
run_allow 'touch tmp/a.txt'         'touch tmp/a.txt'
run_allow 'mv tmp/a.md tmp/b.md'    'mv tmp/a.md tmp/b.md'
run_allow 'chmod 755 tmp/x.sh'      'chmod 755 tmp/x.sh'
run_allow 'cp tmp/a tmp/b'          'cp tmp/a tmp/b'

echo ""
echo "--- defer 対象（出力なし、デフォルト判定に委ねる） ---"

run_defer 'rm -rf src/'                    'rm -rf src/'
run_defer 'rm src/a.ts tmp/b.txt'          'rm src/a.ts tmp/b.txt'
run_defer 'cp src/a.ts tmp/'               'cp src/a.ts tmp/'
run_defer 'rm tmp/*.py（グロブ）'           'rm tmp/*.py'
run_defer 'rm "tmp/a b.txt"（クォート）'    'rm "tmp/a b.txt"'
run_defer 'rm tmp/$(whoami)'               'rm tmp/$(whoami)'
run_defer 'ls tmp/（verb 非対象）'          'ls tmp/'
run_defer 'rm -rf tmp/x && rm -rf src（複合）' 'rm -rf tmp/x && rm -rf src'
run_defer 'rm /tmp/x（システム /tmp）'      'rm /tmp/x'
run_defer 'rm -rf tmp/../src（トラバーサル）'      'rm -rf tmp/../src'
run_defer 'rm -rf tmp/../../other（トラバーサル）' 'rm -rf tmp/../../other'
run_defer 'rm tmp/a/../../.env（中間 ..）'         'rm tmp/a/../../.env'

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
