#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/lib/common.sh

# --- usage ---
usage() {
  cat <<EOF
Usage: $(basename "$0") <ENV>

カタログ YAML から PostgreSQL の init スクリプトを自動生成します。

ENV:
  sample       サンプルデータ環境
  production   本番データ環境

Output:
  postgres/init/<ENV>/create-tables.sql
  postgres/init/<ENV>/load-data.py

Options:
  -h, --help   このヘルプを表示

Examples:
  $(basename "$0") sample
  $(basename "$0") production
EOF
}

# --- 引数パース ---
ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -*)        echo "Error: unknown option '$1'" >&2; usage; exit 1 ;;
    *)
      if [[ -n "$ENV" ]]; then
        echo "Error: multiple environments specified" >&2; usage; exit 1
      fi
      # バリデーション
      if ! validate_env "$1"; then
        exit 1
      fi
      ENV="$1"; shift ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "Error: environment is required" >&2
  usage
  exit 1
fi

# --- カタログ YAML の存在確認 ---
CATALOG_DIR="document-server/data/${ENV}/catalog"
if [[ ! -d "$CATALOG_DIR" ]]; then
  echo "Error: catalog directory not found: $CATALOG_DIR" >&2
  exit 1
fi

if [[ ! -f "$CATALOG_DIR/index.yaml" ]]; then
  echo "Error: index.yaml not found: $CATALOG_DIR/index.yaml" >&2
  exit 1
fi

# --- Python スクリプト実行 ---
echo "=== Generating init scripts for '${ENV}' ==="
uv run python scripts/lib/generate_init.py "$ENV"

echo ""
echo "=== Done ==="
