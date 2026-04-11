#!/bin/bash
# Hook 共有 JSON ユーティリティ。
#
# jq があれば jq を、なければ system python3 を使う。
# hook 群が source して利用する。単体実行しない。
#
# フック自身はブートストラップ（`uv sync` 前）でも動く必要があるため、
# ここでは `uv run python` ではなく system `python3` を呼ぶ。これは
# `.claude/rules/python-uv.md` の意図的な例外（ハーネス側インフラ）。

# json_get_path <json_string> <dot_path>
#   ドット区切りパスの値を文字列で返す。見つからなければ空文字。
#   例: json_get_path "$INPUT" .tool_input.command
json_get_path() {
  local json="$1"
  local path="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r "${path} // empty"
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | HOOK_JSON_PATH="$path" python3 -c '
import json, os, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
path = os.environ["HOOK_JSON_PATH"].lstrip(".")
value = data
if path:
    for key in path.split("."):
        if isinstance(value, dict):
            value = value.get(key)
        else:
            value = None
            break
if value is None:
    sys.stdout.write("")
elif isinstance(value, str):
    sys.stdout.write(value)
else:
    sys.stdout.write(json.dumps(value))
'
  else
    echo "ERROR: jq も python3 も利用できないため JSON をパースできません" >&2
    return 1
  fi
}

# json_get_array_items <file> <dot_path>
#   ファイル内の JSON を読み、ドット区切りパスが指す配列要素を 1 行ずつ出力する。
#   文字列要素のみ対応（オブジェクト/配列要素は JSON 文字列化して出力）。
#   ファイルが存在しない/パスが配列でない場合は無出力で終了コード 0 を返す。
json_get_array_items() {
  local file="$1"
  local path="$2"
  [[ -f "$file" ]] || return 0
  if command -v jq >/dev/null 2>&1; then
    jq -r "${path}[]? // empty" "$file" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    HOOK_JSON_PATH="$path" python3 -c '
import json, os, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
path = os.environ["HOOK_JSON_PATH"].lstrip(".")
value = data
if path:
    for key in path.split("."):
        if isinstance(value, dict):
            value = value.get(key)
        else:
            value = None
            break
if isinstance(value, list):
    for item in value:
        if item is None:
            continue
        if isinstance(item, str):
            print(item)
        else:
            print(json.dumps(item))
' "$file" 2>/dev/null
  else
    return 1
  fi
}

# json_emit_ask <reason>
#   PreToolUse の "ask" 決定 JSON を標準出力に出す。
json_emit_ask() {
  local reason="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg reason "$reason" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: $reason
      }
    }'
  elif command -v python3 >/dev/null 2>&1; then
    HOOK_REASON="$reason" python3 -c '
import json, os
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": os.environ["HOOK_REASON"]
  }
}, ensure_ascii=False))
'
  else
    return 1
  fi
}
