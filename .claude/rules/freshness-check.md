# 環境鮮度保証ルール

Docker 環境でのテスト実行時に、ソースコードとビルド成果物の鮮度を自動チェックする。

## チェック対象

| コンポーネント | 比較対象 |
|---------------|---------|
| jupyter-server | Docker イメージ vs `jupyter-server/` ソース |
| document-server | Docker イメージ vs `document-server/` ソース |
| document-server (data) | カタログ YAML 更新時刻 vs document-server コンテナ起動時刻 |
| jupyter-mcp | `dist/` vs `jupyter-mcp/src/` ソース |
| document-mcp | `dist/` vs `document-mcp/src/` ソース |
| postgres (init) | カタログ YAML vs 生成済み init スクリプト |
| postgres (data) | init スクリプト + Parquet vs postgres コンテナ |

## 自動チェックのタイミング

| コマンド | チェック動作 |
|---------|-------------|
| `scripts/test.sh` | Docker 起動中なら警告のみ（テスト続行） |
| `scripts/test.sh --integration` | Docker 必須、古い場合は警告 |
| `scripts/test.sh --integration --rebuild` | 古い場合は自動リビルド |
| `scripts/smoke-test.sh` | 古い場合は警告（テスト続行） |
| `scripts/rebuild.sh` | postgres データの鮮度チェック → 古い場合は自動再初期化 |
| `scripts/rebuild.sh --verify` | リビルド直後なので不要 |

### `--rebuild` 時の自動修正アクション

| STALE コンポーネント | 自動修正 |
|---------------------|---------|
| jupyter-server / document-server | `docker compose build` + `docker compose up -d` |
| jupyter-mcp / document-mcp | `npm run build` |
| postgres (init) | `generate-init-scripts.sh` + `switch-env.sh --force-reload` で DB 再構築 |
| postgres (data) | `switch-env.sh --force-reload` で DB 再初期化 |
| document-server (data) | `docker compose restart document-server` |

> **注意**: postgres (init) と postgres (data) が同時に STALE の場合、`switch-env.sh` は1回のみ実行される。

## 手動チェック

手動での鮮度チェックコマンドは `.claude/rules/scripts.md` を参照すること。
