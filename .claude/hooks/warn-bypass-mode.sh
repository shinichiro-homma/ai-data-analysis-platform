#!/bin/bash

# bypassPermissions モードが有効な時に警告を表示する hook

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

# 警告メッセージを表示
echo "{
  \"decision\": \"allow\",
  \"reason\": \"[BYPASS MODE] $TOOL_NAME を実行します（自動許可モード）\"
}"

exit 0
