# document-server

YAMLカタログを読み込み、検索APIを提供するサーバー。

## 概要

- 事前作成されたYAMLカタログを起動時に読み込み
- テーブル一覧、詳細、検索APIを提供
- document-mcp からREST API経由で操作される

## 技術スタック

- Python 3.11+
- FastAPI
- PyYAML
- uvicorn

## ディレクトリ構成

```
document-server/
├── CLAUDE.md
├── pyproject.toml
├── requirements.txt
├── catalog/                  # カタログファイル
│   ├── _datasources.yaml
│   └── *.yaml
├── src/
│   ├── main.py
│   ├── config.py
│   ├── models.py
│   ├── catalog_loader.py
│   ├── search.py
│   └── routers/
│       ├── tables.py
│       └── search.py
└── tests/
```

## コマンド

```bash
# 依存関係インストール
pip install -r requirements.txt

# 開発（ホットリロード）
uvicorn src.main:app --reload --port 3002

# 本番起動
uvicorn src.main:app --host 0.0.0.0 --port 3002

# テスト
pytest

# 型チェック
mypy src/
```

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `CATALOG_DIR` | カタログディレクトリ | ./catalog |
| `PORT` | サーバーポート | 3002 |
| `DB_HOST` | DBホスト | localhost |
| `DB_USER` | DBユーザー | （必須） |
| `DB_PASSWORD` | DBパスワード | （必須） |

## 主要API

| エンドポイント | 説明 |
|---------------|------|
| `GET /api/v1/tables` | テーブル一覧 |
| `GET /api/v1/tables/{name}` | テーブル詳細 |
| `GET /api/v1/search?q=...` | キーワード検索 |
| `GET /api/v1/tags` | タグ一覧 |
| `POST /api/v1/admin/reload` | カタログ再読み込み |
| `GET /health` | ヘルスチェック |

## カタログファイル形式

`catalog/_datasources.yaml`:
```yaml
datasources:
  - id: main_db
    name: 基幹データベース
    type: postgresql
    connection:
      host: ${DB_HOST}
      port: 5432
      database: sales_db
```

`catalog/sales.yaml`:
```yaml
tables:
  - name: sales_transactions
    display_name: 売上トランザクション
    description: 日次の売上データ
    datasource: main_db
    tags: [売上, トランザクション]
    columns:
      - name: id
        type: bigint
        description: トランザクションID
```

## 要件定義

詳細は [docs/requirements/document-server.md](../docs/requirements/document-server.md) を参照。

## 依存関係

- なし（document-mcp が本サーバーに依存）
