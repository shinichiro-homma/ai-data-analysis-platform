#!/bin/bash
# .claude/hooks/lib/json.sh のテスト
# 実行: bash .claude/hooks/tests/json-lib.test.sh
#
# jq が利用可能なら jq パスと python3 フォールバックパスの両方を検証する。
# jq が未インストールなら python3 パスのみ検証する。

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
LIB="${PROJECT_DIR}/.claude/hooks/lib/json.sh"

if [[ ! -f "$LIB" ]]; then
  echo "ERROR: lib not found: $LIB" >&2
  exit 1
fi

# shellcheck source=/dev/null
. "$LIB"

PASS=0
FAIL=0
FAILURES=()

assert_eq() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected: $(printf %q "$expected")"
    echo "    actual:   $(printf %q "$actual")"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

run_suite() {
  local label="$1"
  echo ""
  echo "=== $label ==="

  # json_get_path: ネストしたドットパス
  local out
  out=$(json_get_path '{"tool_input":{"command":"echo hi"}}' .tool_input.command)
  assert_eq "${label}: .tool_input.command → \"echo hi\"" "echo hi" "$out"

  # json_get_path: トップレベル
  out=$(json_get_path '{"tool_name":"Bash"}' .tool_name)
  assert_eq "${label}: .tool_name → \"Bash\"" "Bash" "$out"

  # json_get_path: キー欠損 → 空文字列
  out=$(json_get_path '{"tool_input":{}}' .tool_input.command)
  assert_eq "${label}: 欠損キー → 空文字" "" "$out"

  # json_get_path: パス途中が null → 空文字列
  out=$(json_get_path '{"tool_input":null}' .tool_input.command)
  assert_eq "${label}: null 中間 → 空文字" "" "$out"

  # json_get_path: 空 JSON → 空文字列
  out=$(json_get_path '{}' .tool_input.command)
  assert_eq "${label}: 空 JSON → 空文字" "" "$out"

  # json_get_path: クォート含むコマンド
  out=$(json_get_path '{"tool_input":{"command":"echo \"hi\""}}' .tool_input.command)
  assert_eq "${label}: クォート付きコマンド" 'echo "hi"' "$out"

  # json_get_array_items: 配列読み取り
  local tmpfile
  tmpfile=$(mktemp)
  printf '%s' '{"permissions":{"allow":["Read","Bash(git:*)","Write"]}}' > "$tmpfile"
  local items
  items=$(json_get_array_items "$tmpfile" .permissions.allow | tr '\n' '|')
  assert_eq "${label}: 配列要素 3 個" "Read|Bash(git:*)|Write|" "$items"

  # json_get_array_items: 配列なし → 空
  printf '%s' '{"permissions":{}}' > "$tmpfile"
  items=$(json_get_array_items "$tmpfile" .permissions.allow)
  assert_eq "${label}: 配列欠損 → 空" "" "$items"

  # json_get_array_items: ファイル非存在 → 空
  items=$(json_get_array_items "/nonexistent/file.json" .permissions.allow)
  assert_eq "${label}: ファイル非存在 → 空" "" "$items"

  rm -f "$tmpfile"

  # json_emit_ask: 出力 JSON に reason が含まれる
  local ask_out
  ask_out=$(json_emit_ask "テスト用メッセージ")
  if printf '%s' "$ask_out" | grep -q 'テスト用メッセージ' \
    && printf '%s' "$ask_out" | grep -q '"permissionDecision"' \
    && printf '%s' "$ask_out" | grep -q '"ask"'; then
    echo "  PASS: ${label}: json_emit_ask"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label}: json_emit_ask"
    echo "    output: $ask_out"
    FAIL=$((FAIL + 1))
    FAILURES+=("${label}: json_emit_ask")
  fi
}

# python3 フォールバックパスを強制するため、jq を含まない隔離 PATH を用意する。
# 決め打ちの /usr/bin:/bin は環境によっては jq を含む（macOS 同梱等）ため使わない。
# 代わりに、run_suite と json.sh が実際に使う外部コマンドのシンボリックリンクだけを
# 一時ディレクトリに置き、PATH をそのディレクトリ 1 つに絞ることで jq を確実に隠す。
RESTRICTED_PATH_DIR=$(mktemp -d)
trap 'rm -rf "$RESTRICTED_PATH_DIR"' EXIT

# 1. jq が利用可能ならまず jq パスを検証
if command -v jq >/dev/null 2>&1; then
  run_suite "jq パス"
else
  echo ""
  echo "=== jq パス（jq 未インストールのためスキップ）==="
fi

# 2. python3 パスを強制検証:
#    jq を除いた必要コマンドのみを隔離ディレクトリにリンクし、PATH をそこだけにする
if command -v python3 >/dev/null 2>&1; then
  OLD_PATH="$PATH"
  # run_suite が使う外部コマンド（mktemp/tr/grep/rm）と
  # json.sh のフォールバックが使う python3 のみをリンクする。jq は意図的に除外。
  for cmd in python3 mktemp tr grep rm; do
    real="$(command -v "$cmd" 2>/dev/null || true)"
    [[ -n "$real" ]] && ln -sf "$real" "$RESTRICTED_PATH_DIR/$cmd"
  done
  export PATH="$RESTRICTED_PATH_DIR"
  if command -v jq >/dev/null 2>&1; then
    echo ""
    echo "WARNING: 制限 PATH でも jq が見えてしまったため python3 フォールバックは未検証"
  else
    run_suite "python3 フォールバックパス"
  fi
  export PATH="$OLD_PATH"
else
  echo ""
  echo "=== python3 フォールバック（python3 なしのためスキップ）==="
fi

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
