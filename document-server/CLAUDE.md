# document-server

YAMLカタログ・用語集・既存ロジックを読み込み、APIを提供するサーバー。

## 概要

- 事前作成されたYAMLカタログ（テーブル定義）、用語集、既存ロジックを起動時に読み込み
- テーブル・用語・ロジックのインデックス/詳細APIを提供
- document-mcp からREST API経由で操作される

## 技術スタック

[docs/requirements/document-server.md](../docs/requirements/document-server.md) を参照。

## コマンド

ルートで `uv sync` 済みであれば追加操作不要。

```bash
uv run uvicorn src.main:app --reload --port 3002          # 開発
uv run uvicorn src.main:app --host 0.0.0.0 --port 3002   # 本番
uv run pytest                                              # テスト
uv run mypy src/                                           # 型チェック
```

## 環境変数

| 変数 | 説明 |
|------|------|
| `DOCUMENT_SERVER_TOKEN` | Bearer 認証トークン（必須、未設定時は起動中止） |
| `DATA_DIR` | データディレクトリパス（`DATA_ENV` より優先） |
| `DATA_ENV` | データセット環境（`sample` / `production`） |
| `PORT` | サーバーポート |
| `CORS_ORIGINS` | CORS許可オリジン（カンマ区切り） |

> デフォルト値・解決ロジックは `src/config.py` を参照。

## 主要API

| エンドポイント | 説明 |
|---------------|------|
| `GET /catalog/index` | テーブルインデックス |
| `POST /catalog/tables` | テーブル詳細（一括取得対応、上限は `src/models.py` 参照） |
| `GET /glossary/index` | 用語インデックス（query パラメータで検索可能、上限は `src/routers/terms.py` 参照） |
| `POST /glossary/terms` | 用語詳細（一括取得対応、上限は `src/models.py` 参照） |
| `GET /logic/index` | ロジックインデックス |
| `POST /logic/meta` | ロジックメタ（一括取得対応、上限は `src/models.py` 参照） |
| `GET /logic/code/{logic_name}` | ロジックコード（バリデーションは `src/routers/logic.py` 参照） |
| `POST /admin/reload` | カタログ・用語集・ロジックの再読み込み |
| `GET /health` | ヘルスチェック |

## 要件定義

詳細は [docs/requirements/document-server.md](../docs/requirements/document-server.md) を参照。

## 依存関係

- なし（document-mcp が本サーバーに依存）
