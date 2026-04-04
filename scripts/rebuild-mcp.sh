#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

MCP_SERVERS=(jupyter-mcp document-mcp)

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [SERVER...]

MCP サーバーをリビルドします。

SERVER:
  jupyter-mcp     Jupyter MCP サーバーのみ
  document-mcp    Document MCP サーバーのみ
  (省略時は全 MCP サーバー)

OPTIONS:
  --install   npm install も実行する
  --clean     dist/ + node_modules/ を削除してクリーンビルド
  --check     型チェックのみ (ビルドしない)
  -h, --help  このヘルプを表示

Examples:
  $(basename "$0")                        # 全 MCP サーバーをビルド
  $(basename "$0") jupyter-mcp            # jupyter-mcp のみビルド
  $(basename "$0") --install              # npm install + ビルド
  $(basename "$0") --clean                # クリーンビルド
  $(basename "$0") --check                # 型チェックのみ
EOF
}

INSTALL=false
CLEAN=false
CHECK_ONLY=false
TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)    INSTALL=true; shift ;;
    --clean)      CLEAN=true; shift ;;
    --check)      CHECK_ONLY=true; shift ;;
    -h|--help)    usage; exit 0 ;;
    -*)           echo "Error: unknown option $1" >&2; usage; exit 1 ;;
    *)
      found=false
      for s in "${MCP_SERVERS[@]}"; do
        if [[ "$1" == "$s" ]]; then found=true; break; fi
      done
      if ! $found; then
        echo "Error: unknown server '$1' (available: ${MCP_SERVERS[*]})" >&2
        exit 1
      fi
      TARGETS+=("$1"); shift ;;
  esac
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("${MCP_SERVERS[@]}")
fi

if $CLEAN; then
  INSTALL=true
fi

echo "=== MCP Server Rebuild ==="
echo "Targets: ${TARGETS[*]}"
echo ""

FAILED=()

for server in "${TARGETS[@]}"; do
  echo "--- $server ---"

  if [[ ! -d "$server" ]]; then
    echo "  SKIP: directory not found"
    FAILED+=("$server")
    continue
  fi

  if $CLEAN; then
    echo "  Cleaning dist/ and node_modules/..."
    rm -rf "$server/dist"
    rm -rf "$server/node_modules"
  fi

  if $INSTALL; then
    echo "  npm install..."
    (cd "$server" && npm install) || { FAILED+=("$server"); echo "  FAILED: npm install" >&2; continue; }
  fi

  if $CHECK_ONLY; then
    echo "  Type checking..."
    (cd "$server" && npm run typecheck) || { FAILED+=("$server"); echo "  FAILED: typecheck" >&2; continue; }
  else
    echo "  Building..."
    (cd "$server" && npm run build) || { FAILED+=("$server"); echo "  FAILED: build" >&2; continue; }
  fi

  echo "  OK"
  echo ""
done

echo "=== Result ==="
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "All targets succeeded."
else
  echo "FAILED: ${FAILED[*]}"
  exit 1
fi
