#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [COMPONENT...]

テストマップ（テストファイル → テスト名一覧）を生成します。
既存テストの所在確認のためにテストファイルを開く代わりに、まずこのマップを読み、
開くファイルを絞り込んでから該当行範囲のみを Read してください（計画フェーズで使用）。

COMPONENT:
  jupyter-mcp           jupyter-mcp/tests (vitest)
  document-mcp          document-mcp/tests (vitest)
  jupyter-server        jupyter-server/tests (pytest)
  document-server       document-server/tests (pytest)
  e2e                   tests/e2e (vitest)
  (省略時は全対象。jupyterlab-ai-sync はテストなしのため対象外)

OPTIONS:
  -h, --help      このヘルプを表示

出力形式:
  {テストファイルパス}
    {行番号}: {describe|it|test|class|def} {テスト名}

Examples:
  $(basename "$0") jupyter-mcp          # jupyter-mcp のみ
  $(basename "$0") jupyter-server e2e   # 複数指定

出力が大きいコンポーネント（jupyter-mcp 等）は tmp/ に書き出して Grep で絞り込む:
  $(basename "$0") jupyter-mcp > tmp/test-map.txt
EOF
}

# ── Target definitions ──

ALL_COMPONENTS=(jupyter-mcp document-mcp jupyter-server document-server e2e)

component_test_dir() {
  case "$1" in
    jupyter-mcp)     echo "jupyter-mcp/tests" ;;
    document-mcp)    echo "document-mcp/tests" ;;
    jupyter-server)  echo "jupyter-server/tests" ;;
    document-server) echo "document-server/tests" ;;
    e2e)             echo "tests/e2e" ;;
  esac
}

component_lang() {
  case "$1" in
    jupyter-server|document-server) echo "python" ;;
    *)                              echo "typescript" ;;
  esac
}

# ── Extractors ──

# TypeScript: describe / it / test（.each 等の修飾付き含む）の第1引数の文字列を抽出
map_ts_file() {
  awk '
    BEGIN { sq = sprintf("%c", 39); bt = sprintf("%c", 96) }
    match($0, /^[[:space:]]*(describe|it|test)(\.[a-zA-Z]+)?\(/) {
      kw = $0
      sub(/^[[:space:]]*/, "", kw)
      sub(/\(.*/, "", kw)
      rest = substr($0, RSTART + RLENGTH)
      q = substr(rest, 1, 1)
      name = rest
      if (q == sq || q == "\"" || q == bt) {
        name = substr(rest, 2)
        idx = index(name, q)
        if (idx > 0) name = substr(name, 1, idx - 1)
      }
      printf "  %d: %s %s\n", NR, kw, name
    }
  ' "$1"
}

# Python: class Test* / (async) def test_* の定義行を抽出
map_py_file() {
  awk '
    match($0, /^[[:space:]]*(class Test|async def test_|def test_)/) {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      sub(/\(.*/, "", line)
      sub(/:[[:space:]]*$/, "", line)
      printf "  %d: %s\n", NR, line
    }
  ' "$1"
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

# ── Generate map ──

for component in "${TARGETS[@]}"; do
  test_dir="$(component_test_dir "$component")"
  lang="$(component_lang "$component")"

  echo "=== $component ($lang: $test_dir) ==="

  if [[ ! -d "$test_dir" ]]; then
    echo "  (test directory not found)"
    echo ""
    continue
  fi

  file_count=0
  if [[ "$lang" == "typescript" ]]; then
    while IFS= read -r file; do
      echo "$file"
      map_ts_file "$file"
      file_count=$((file_count + 1))
    done < <(find "$test_dir" -name "*.test.ts" -type f | sort)
  else
    while IFS= read -r file; do
      echo "$file"
      map_py_file "$file"
      file_count=$((file_count + 1))
    done < <(find "$test_dir" -name "test_*.py" -type f | sort)
  fi

  echo "  ($component: $file_count test files)"
  echo ""
done
