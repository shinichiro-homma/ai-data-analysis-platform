#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [COMPONENT...]

コードの lint / format チェックを実行します（検出のみ、自動修正なし）。
CI と同じルールをローカルで事前チェックできます。

COMPONENT:
  jupyter-mcp       Jupyter MCP サーバー (prettier)
  document-mcp      Document MCP サーバー (prettier)
  mcp-shared        MCP 共有パッケージ (prettier)
  document-server   Document サーバー (ruff)
  jupyter-server    Jupyter サーバー (ruff)
  scripts           運用スクリプト (ruff)
  (省略時は全対象)

OPTIONS:
  -h, --help      このヘルプを表示

Examples:
  $(basename "$0")                      # 全対象をチェック
  $(basename "$0") jupyter-mcp          # jupyter-mcp のみ
  $(basename "$0") document-server      # document-server のみ
EOF
}

# ── Target definitions ──

TS_COMPONENTS=(jupyter-mcp document-mcp mcp-shared)
PY_COMPONENTS=(document-server jupyter-server scripts)
ALL_COMPONENTS=("${TS_COMPONENTS[@]}" "${PY_COMPONENTS[@]}")

# Prettier target paths (must match CI)
prettier_targets() {
  local component="$1"
  case "$component" in
    jupyter-mcp)  echo "jupyter-mcp/src/**/*.ts" ;;
    document-mcp) echo "document-mcp/src/**/*.ts" ;;
    mcp-shared)   echo "packages/mcp-shared/src/**/*.ts" ;;
  esac
}

# Ruff target paths (must match CI)
ruff_targets() {
  local component="$1"
  case "$component" in
    document-server) echo "document-server/src/ document-server/tests/" ;;
    jupyter-server)  echo "jupyter-server/extensions/ jupyter-server/tests/" ;;
    scripts)         echo "scripts/*.py scripts/lib/*.py" ;;
  esac
}

# ── Parse arguments ──

TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -*)        echo "Error: unknown option $1" >&2; usage; exit 1 ;;
    *)
      found=false
      for c in "${ALL_COMPONENTS[@]}"; do
        if [[ "$1" == "$c" ]]; then found=true; break; fi
      done
      if ! $found; then
        echo "Error: unknown component '$1' (available: ${ALL_COMPONENTS[*]})" >&2
        exit 1
      fi
      TARGETS+=("$1"); shift ;;
  esac
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("${ALL_COMPONENTS[@]}")
fi

# ── Classify targets ──

TS_TARGETS=()
PY_TARGETS=()

for t in "${TARGETS[@]}"; do
  for c in "${TS_COMPONENTS[@]}"; do
    if [[ "$t" == "$c" ]]; then TS_TARGETS+=("$t"); fi
  done
  for c in "${PY_COMPONENTS[@]}"; do
    if [[ "$t" == "$c" ]]; then PY_TARGETS+=("$t"); fi
  done
done

# ── Run checks ──

echo "=== Lint / Format Check ==="
FAILED=()

# TypeScript: prettier --check
if [[ ${#TS_TARGETS[@]} -gt 0 ]]; then
  echo ""
  echo "--- Prettier (TypeScript) ---"

  if ! command -v npx >/dev/null 2>&1; then
    echo "  ERROR: npx not found. Install Node.js." >&2
    FAILED+=("prettier:not-found")
  else
    PRETTIER_GLOBS=()
    for component in "${TS_TARGETS[@]}"; do
      PRETTIER_GLOBS+=("$(prettier_targets "$component")")
    done

    echo "  Checking: ${PRETTIER_GLOBS[*]}"
    if npx prettier --check "${PRETTIER_GLOBS[@]}" 2>&1; then
      echo "  Prettier OK"
    else
      FAILED+=("prettier")
      echo "  FAILED: prettier"
    fi
  fi
fi

# Python: ruff format --check + ruff check
if [[ ${#PY_TARGETS[@]} -gt 0 ]]; then
  echo ""
  echo "--- Ruff (Python) ---"

  if ! command -v ruff >/dev/null 2>&1; then
    echo "  ERROR: ruff not found. Install with: pip install ruff" >&2
    FAILED+=("ruff:not-found")
  else
    RUFF_PATHS=()
    for component in "${PY_TARGETS[@]}"; do
      # Word-split intentionally — paths may contain multiple entries
      # shellcheck disable=SC2206
      RUFF_PATHS+=($(ruff_targets "$component"))
    done

    echo "  Checking format: ${RUFF_PATHS[*]}"
    if ruff format --check "${RUFF_PATHS[@]}" 2>&1; then
      echo "  Ruff format OK"
    else
      FAILED+=("ruff-format")
      echo "  FAILED: ruff format"
    fi

    echo "  Checking lint: ${RUFF_PATHS[*]}"
    if ruff check "${RUFF_PATHS[@]}" 2>&1; then
      echo "  Ruff lint OK"
    else
      FAILED+=("ruff-lint")
      echo "  FAILED: ruff lint"
    fi
  fi
fi

# ── Result ──

echo ""
echo "=== Lint Result ==="
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "All checks passed."
else
  echo "FAILED: ${FAILED[*]}"
  exit 1
fi
