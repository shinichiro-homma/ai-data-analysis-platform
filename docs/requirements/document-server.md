# document-server 要件定義

## 概要

事前に作成されたデータカタログを読み込み、検索APIを提供するサーバー。生成AIが適切なデータソースを特定できるようにする。

## 前提条件

- データカタログは事前にYAMLまたはJSONファイルとして作成済み
- 分析対象のデータベースは既存のものを使用
- PoCフェーズでは、カタログの動的な登録・更新機能は不要

## 用語定義

| 用語 | 説明 |
|------|------|
| テーブル | データの単位。既存DBのテーブルやビュー |
| カラム | テーブル内のフィールド/列 |
| タグ | テーブルに付与する分類ラベル |
| カタログファイル | テーブル情報を記述したYAML/JSONファイル |

## 機能要件

### F1: カタログ読み込み

#### F1.1: 起動時読み込み
- 指定ディレクトリからカタログファイルを読み込む
- YAML/JSON形式に対応
- 複数ファイルの読み込みに対応（テーブル単位で分割可能）

#### F1.2: リロード
- API経由でカタログを再読み込みできる
- ファイル変更時にサーバー再起動不要

### F2: テーブル情報取得

#### F2.1: テーブル一覧
- 登録済みテーブルの一覧を取得
- タグでフィルタ可能

#### F2.2: テーブル詳細
- 指定テーブルの詳細情報を取得
- カラム情報、タグ、サンプルデータを含む

#### F2.3: 関連テーブル取得
- 指定テーブルの関連テーブル一覧を取得

### F3: 検索機能

#### F3.1: キーワード検索
- テーブル名、説明、カラム名から検索
- 日本語対応
- 関連度スコアでソート

#### F3.2: タグ検索
- 指定タグを持つテーブルを検索

### F4: 接続情報提供

#### F4.1: 接続情報取得
- テーブルが属するデータベースへの接続情報を取得
- jupyter-serverでの接続に必要な情報を返却

## カタログファイル形式

### ディレクトリ構成

```
catalog/
├── _datasources.yaml    # データソース定義
├── sales.yaml           # 売上関連テーブル
├── products.yaml        # 商品関連テーブル
└── stores.yaml          # 店舗関連テーブル
```

### データソース定義（_datasources.yaml）

```yaml
datasources:
  - id: main_db
    name: 基幹データベース
    type: postgresql
    connection:
      host: ${DB_HOST}           # 環境変数で上書き可能
      port: 5432
      database: sales_db
      # user/password は環境変数から取得
```

### テーブル定義（例: sales.yaml）

```yaml
tables:
  - name: sales_transactions
    display_name: 売上トランザクション
    description: |
      日次の売上データ。
      店舗別、商品別の売上金額と数量を記録。
      毎日午前2時にバッチ処理で更新される。
    datasource: main_db
    schema: public
    tags:
      - 売上
      - トランザクション
      - 日次
    row_count: 5000000
    
    columns:
      - name: id
        type: bigint
        description: トランザクションID（主キー）
        primary_key: true
        
      - name: store_id
        type: integer
        description: 店舗ID
        foreign_key:
          table: stores
          column: id
          
      - name: product_id
        type: integer
        description: 商品ID
        foreign_key:
          table: products
          column: id
          
      - name: amount
        type: decimal(10,2)
        description: 売上金額（税込）
        
      - name: quantity
        type: integer
        description: 販売数量
        
      - name: transaction_date
        type: date
        description: 取引日
    
    sample_data:
      - id: 1
        store_id: 101
        product_id: 501
        amount: 1500.00
        quantity: 3
        transaction_date: "2024-01-15"
      - id: 2
        store_id: 102
        product_id: 502
        amount: 800.00
        quantity: 1
        transaction_date: "2024-01-15"
    
    related_tables:
      - table: stores
        type: foreign_key
        description: store_id で結合
      - table: products
        type: foreign_key
        description: product_id で結合
      - table: daily_sales_summary
        type: derived
        description: このテーブルを日次集計したもの
    
    notes: |
      - 分析時は transaction_date でフィルタすることを推奨
      - 大量データのため、全件取得は避けること
```

### 最小構成（シンプルなテーブル定義）

```yaml
tables:
  - name: products
    display_name: 商品マスタ
    description: 商品の基本情報
    datasource: main_db
    tags:
      - マスタ
      - 商品
    columns:
      - name: id
        type: integer
        description: 商品ID
      - name: name
        type: varchar(100)
        description: 商品名
      - name: price
        type: decimal(10,2)
        description: 単価
```

## API仕様

### テーブル

| メソッド | エンドポイント | 説明 |
|---------|---------------|------|
| GET | `/api/v1/tables` | テーブル一覧 |
| GET | `/api/v1/tables/{name}` | テーブル詳細 |
| GET | `/api/v1/tables/{name}/sample` | サンプルデータ |
| GET | `/api/v1/tables/{name}/related` | 関連テーブル |
| GET | `/api/v1/tables/{name}/connection` | 接続情報 |

### 検索

| メソッド | エンドポイント | 説明 |
|---------|---------------|------|
| GET | `/api/v1/search?q={query}` | キーワード検索 |
| GET | `/api/v1/tags` | タグ一覧 |
| GET | `/api/v1/tags/{tag}/tables` | タグでテーブル検索 |

### 管理

| メソッド | エンドポイント | 説明 |
|---------|---------------|------|
| POST | `/api/v1/admin/reload` | カタログ再読み込み |
| GET | `/health` | ヘルスチェック |

## APIレスポンス例

### テーブル一覧

```http
GET /api/v1/tables?tag=売上
```

```json
{
  "tables": [
    {
      "name": "sales_transactions",
      "display_name": "売上トランザクション",
      "description": "日次の売上データ...",
      "tags": ["売上", "トランザクション", "日次"],
      "column_count": 6,
      "row_count": 5000000
    },
    {
      "name": "daily_sales_summary",
      "display_name": "日次売上サマリー",
      "description": "日次の売上集計...",
      "tags": ["売上", "集計", "日次"],
      "column_count": 4,
      "row_count": 10000
    }
  ],
  "total": 2
}
```

### キーワード検索

```http
GET /api/v1/search?q=売上%20地域
```

```json
{
  "results": [
    {
      "name": "regional_sales_summary",
      "display_name": "地域別売上サマリー",
      "description": "地域ごとの売上集計...",
      "tags": ["売上", "地域", "集計"],
      "score": 0.95,
      "matched_in": ["display_name", "tags"]
    }
  ],
  "total": 1,
  "query": "売上 地域"
}
```

### テーブル詳細

```http
GET /api/v1/tables/sales_transactions
```

```json
{
  "name": "sales_transactions",
  "display_name": "売上トランザクション",
  "description": "日次の売上データ...",
  "datasource": "main_db",
  "schema": "public",
  "tags": ["売上", "トランザクション", "日次"],
  "row_count": 5000000,
  "columns": [
    {
      "name": "id",
      "type": "bigint",
      "description": "トランザクションID（主キー）",
      "primary_key": true
    },
    {
      "name": "store_id",
      "type": "integer",
      "description": "店舗ID",
      "foreign_key": {
        "table": "stores",
        "column": "id"
      }
    }
  ],
  "related_tables": [
    {
      "table": "stores",
      "type": "foreign_key",
      "description": "store_id で結合"
    }
  ],
  "notes": "分析時は transaction_date でフィルタすることを推奨..."
}
```

### 接続情報

```http
GET /api/v1/tables/sales_transactions/connection
```

```json
{
  "datasource": "main_db",
  "type": "postgresql",
  "connection_string": "postgresql://user:***@host:5432/sales_db",
  "schema": "public",
  "table": "sales_transactions"
}
```

※ パスワードはマスク表示。実際の接続は環境変数から取得。

## 非機能要件

### NF1: パフォーマンス

| 項目 | 要件 |
|------|------|
| 検索応答時間 | 200ms以内 |
| 起動時間 | 5秒以内（100テーブル規模） |

### NF2: セキュリティ

- DB接続情報は環境変数から取得
- 接続情報APIはパスワードをマスク

### NF3: 運用性

- カタログファイルの変更はAPI経由で再読み込み
- YAMLの構文エラーは起動時に検出・報告

## 技術仕様

### 技術スタック

- Python 3.11+ / FastAPI
- PyYAML（カタログ読み込み）
- インメモリ検索（起動時にカタログを読み込み）

### ディレクトリ構成

```
document-server/
├── CLAUDE.md
├── pyproject.toml
├── catalog/                  # カタログファイル配置
│   ├── _datasources.yaml
│   └── *.yaml
├── src/
│   ├── main.py
│   ├── config.py
│   ├── models.py            # Pydanticモデル
│   ├── catalog_loader.py    # カタログ読み込み
│   ├── search.py            # 検索ロジック
│   └── routers/
│       ├── tables.py
│       └── search.py
└── tests/
    └── ...
```

### 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `CATALOG_DIR` | カタログファイルディレクトリ | ./catalog |
| `PORT` | サーバーポート | 3002 |
| `DB_HOST` | DBホスト（カタログ内で参照） | localhost |
| `DB_USER` | DBユーザー | （必須） |
| `DB_PASSWORD` | DBパスワード | （必須） |

### 起動コマンド

```bash
# 開発
uvicorn src.main:app --reload --port 3002

# 本番
uvicorn src.main:app --host 0.0.0.0 --port 3002
```

## 受け入れ条件

### AC1: カタログ読み込み
- [ ] 起動時にcatalogディレクトリからYAMLファイルを読み込む
- [ ] 複数ファイルを読み込める
- [ ] YAML構文エラーがあれば起動時にエラー表示

### AC2: テーブル情報
- [ ] テーブル一覧を取得できる
- [ ] テーブル名で詳細を取得できる
- [ ] カラム情報、サンプルデータが含まれる

### AC3: 検索
- [ ] キーワードでテーブルを検索できる
- [ ] 日本語で検索できる
- [ ] タグでフィルタできる

### AC4: 接続情報
- [ ] テーブルに紐づくDB接続情報を取得できる
- [ ] パスワードがマスクされている

### AC5: 再読み込み
- [ ] `/api/v1/admin/reload` でカタログを再読み込みできる

## 依存関係

- なし（document-mcp が本サーバーに依存）

## 今後の拡張案（PoC後）

- カタログの動的登録・更新API
- DBスキーマからの自動カタログ生成
- 統計情報の自動収集
- Web UIでのカタログ閲覧・編集
