#!/bin/bash
set -euo pipefail

# scan-inline-python.sh
#
# (uv run )?python3? -c "<code>" のインライン Python 実行を検出し、
# -c 引数が 3 行以上 または 200 文字以上なら ask に流す。
# (uv run )?python3? <(...) プロセス置換は長さに関わらず ask。
#
# 目的: ルール .claude/rules/adhoc-script-execution.md
#       「python3 -c の長文スクリプト禁止」を強制する。
#
# 補足: python/python3 の直叩き自体は block-direct-python.sh が止めるが、
#       本フックは uv run 経由の inline 長文（既存フックを素通りする穴）を
#       主な対象にする。両フックの順序に依存しないよう、直叩きケースも閾値判定する。
#
# フック応答:
#   exit 0 + 出力なし     = 通過
#   exit 0 + ask JSON 出力 = ユーザー承認要求

# shellcheck source=lib/json.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/json.sh"

INPUT=$(cat)
COMMAND=$(json_get_path "$INPUT" .tool_input.command)

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# 早期 return: python という文字列を含まないコマンドはスキップ
case "$COMMAND" in
  *python*) ;;
  *) exit 0 ;;
esac

REASON=$(COMMAND="$COMMAND" python3 - <<'PY'
import os
import re
import shlex

cmd = os.environ.get("COMMAND", "")

LINE_THRESHOLD = 3
CHAR_THRESHOLD = 200

reason = ""

# プロセス置換: (uv run )?python3? <(...) は長さに関わらず ask
proc_sub_re = re.compile(
    r"(?:^|[\s;&|`(])(?:uv\s+run\s+)?(?:[^\s;&|`(]*/)?python3?\s+<\("
)
if proc_sub_re.search(cmd):
    reason = (
        "プロセス置換 `python <(...)` 経由のインライン実行を検出しました。"
        "任意コード実行扱いとして承認が必要です。"
        "tmp/ 配下にスクリプトファイル化することを推奨します。"
        "詳細: .claude/rules/adhoc-script-execution.md"
    )
else:
    try:
        tokens = shlex.split(cmd, comments=False, posix=True)
    except ValueError:
        tokens = []

    i = 0
    while i < len(tokens):
        tok = tokens[i]
        base = os.path.basename(tok) if "/" in tok else tok
        if base in ("python", "python3"):
            if i + 2 < len(tokens) and tokens[i + 1] == "-c":
                code = tokens[i + 2]
                line_count = code.count("\n") + 1
                char_count = len(code)
                if line_count >= LINE_THRESHOLD or char_count >= CHAR_THRESHOLD:
                    reason = (
                        f"インライン Python コード (-c) の長さが閾値を超えました "
                        f"(行数: {line_count}, 文字数: {char_count})。"
                        f"閾値: {LINE_THRESHOLD} 行 または {CHAR_THRESHOLD} 文字以上で承認要求。"
                        f"tmp/ 配下にスクリプトファイル化することを推奨します。"
                        f"詳細: .claude/rules/adhoc-script-execution.md"
                    )
                    break
        i += 1

if reason:
    print(reason, end="")
PY
)

if [[ -n "$REASON" ]]; then
  json_emit_ask "$REASON"
fi

exit 0
