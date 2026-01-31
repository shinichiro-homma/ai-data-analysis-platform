# API仕様

jupyter-mcp ↔ jupyter-server、document-mcp ↔ document-server 間のREST API仕様を定義する。

## 共通仕様

### リクエスト形式

- Content-Type: `application/json`
- 認証: `Authorization: Bearer {token}` ヘッダー

### レスポンス形式

**成功時:**
```json
{
  "data": { ... }
}
```

**エラー時:**
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "エラーメッセージ"
  }
}
```

### 共通エラーコード

| コード | HTTPステータス | 説明 |
|--------|---------------|------|
| `UNAUTHORIZED` | 401 | 認証エラー |
| `NOT_FOUND` | 404 | リソースが見つからない |
| `VALIDATION_ERROR` | 400 | リクエストパラメータ不正 |
| `INTERNAL_ERROR` | 500 | サーバー内部エラー |

---

## jupyter-server API

ベースURL: `http://localhost:8888`

### カーネル管理

#### POST /api/kernels

カーネルを起動する。

**リクエスト:**
```json
{
  "name": "python3"
}
```

**レスポンス:**
```json
{
  "data": {
    "id": "kernel-abc123",
    "name": "python3",
    "status": "starting",
    "started_at": "2024-01-15T10:00:00Z"
  }
}
```

#### GET /api/kernels

起動中のカーネル一覧を取得する。

**レスポンス:**
```json
{
  "data": {
    "kernels": [
      {
        "id": "kernel-abc123",
        "name": "python3",
        "status": "idle",
        "started_at": "2024-01-15T10:00:00Z"
      }
    ]
  }
}
```

#### GET /api/kernels/{kernel_id}

カーネルの状態を取得する。

**レスポンス:**
```json
{
  "data": {
    "id": "kernel-abc123",
    "name": "python3",
    "status": "idle",
    "execution_count": 5,
    "started_at": "2024-01-15T10:00:00Z"
  }
}
```

**status の値:**
- `starting` - 起動中
- `idle` - 待機中
- `busy` - 実行中
- `dead` - 停止

#### DELETE /api/kernels/{kernel_id}

カーネルを停止する。

**レスポンス:**
```json
{
  "data": {
    "id": "kernel-abc123",
    "status": "deleted"
  }
}
```

#### POST /api/kernels/{kernel_id}/interrupt

実行中のコードを中断する。

**レスポンス:**
```json
{
  "data": {
    "id": "kernel-abc123",
    "status": "idle"
  }
}
```

#### POST /api/kernels/{kernel_id}/restart

カーネルを再起動する。

**レスポンス:**
```json
{
  "data": {
    "id": "kernel-abc123",
    "status": "starting"
  }
}
```

### コード実行

#### POST /api/kernels/{kernel_id}/execute

コードを実行する。

**リクエスト:**
```json
{
  "code": "import pandas as pd\nprint('Hello')",
  "timeout": 30
}
```

**レスポンス（成功時）:**
```json
{
  "data": {
    "success": true,
    "execution_count": 1,
    "outputs": [
      {
        "type": "stdout",
        "text": "Hello\n"
      }
    ],
    "result": null,
    "images": [],
    "execution_time_ms": 150
  }
}
```

**レスポンス（画像出力あり）:**
```json
{
  "data": {
    "success": true,
    "execution_count": 2,
    "outputs": [],
    "result": null,
    "images": [
      {
        "id": "img-001",
        "mime_type": "image/png",
        "data": "iVBORw0KGgoAAAANSUhEUgAA...",
        "width": 800,
        "height": 600
      }
    ],
    "execution_time_ms": 1200
  }
}
```

**レスポンス（エラー時）:**
```json
{
  "data": {
    "success": false,
    "execution_count": 3,
    "error": {
      "type": "ZeroDivisionError",
      "message": "division by zero",
      "traceback": [
        "Traceback (most recent call last):",
        "  File \"<stdin>\", line 1, in <module>",
        "ZeroDivisionError: division by zero"
      ]
    },
    "execution_time_ms": 10
  }
}
```

**レスポンス（タイムアウト）:**
```json
{
  "data": {
    "success": false,
    "execution_count": 4,
    "error": {
      "type": "TimeoutError",
      "message": "Execution timed out after 30 seconds",
      "traceback": []
    },
    "execution_time_ms": 30000
  }
}
```

### 変数管理

#### GET /api/kernels/{kernel_id}/variables

カーネル内の変数一覧を取得する。

**レスポンス:**
```json
{
  "data": {
    "variables": [
      {
        "name": "df",
        "type": "DataFrame",
        "size": "1000 rows × 5 cols",
        "memory_bytes": 40000
      },
      {
        "name": "x",
        "type": "int",
        "value": 42
      },
      {
        "name": "model",
        "type": "LinearRegression",
        "size": "fitted"
      }
    ]
  }
}
```

#### GET /api/kernels/{kernel_id}/variables/{name}

指定変数の値を取得する。

**レスポンス（単純な値）:**
```json
{
  "data": {
    "name": "x",
    "type": "int",
    "value": 42
  }
}
```

**レスポンス（DataFrame）:**
```json
{
  "data": {
    "name": "df",
    "type": "DataFrame",
    "shape": [1000, 5],
    "columns": [
      {
        "name": "id",
        "dtype": "int64"
      },
      {
        "name": "name",
        "dtype": "object"
      },
      {
        "name": "value",
        "dtype": "float64"
      }
    ],
    "head": [
      {"id": 1, "name": "A", "value": 100.5},
      {"id": 2, "name": "B", "value": 200.3},
      {"id": 3, "name": "C", "value": 150.0}
    ],
    "describe": {
      "id": {"count": 1000, "mean": 500.5, "min": 1, "max": 1000},
      "value": {"count": 1000, "mean": 150.2, "std": 45.3, "min": 10.0, "max": 300.0}
    },
    "memory_bytes": 40000
  }
}
```

### ノートブック管理

#### GET /api/contents

ファイル一覧を取得する。

**クエリパラメータ:**
- `path` - ディレクトリパス（デフォルト: `/`）

**レスポンス:**
```json
{
  "data": {
    "path": "/",
    "contents": [
      {
        "name": "analysis.ipynb",
        "type": "notebook",
        "size": 15000,
        "modified_at": "2024-01-15T10:00:00Z"
      },
      {
        "name": "data",
        "type": "directory",
        "modified_at": "2024-01-14T08:00:00Z"
      }
    ]
  }
}
```

#### POST /api/contents

ノートブックまたはファイルを作成する。

**リクエスト（ノートブック）:**
```json
{
  "type": "notebook",
  "path": "/analysis.ipynb"
}
```

**レスポンス:**
```json
{
  "data": {
    "path": "/analysis.ipynb",
    "type": "notebook",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

#### GET /api/contents/{path}

ファイルまたはノートブックの内容を取得する。

**レスポンス（ノートブック）:**
```json
{
  "data": {
    "path": "/analysis.ipynb",
    "type": "notebook",
    "content": {
      "cells": [
        {
          "cell_type": "code",
          "source": "import pandas as pd",
          "outputs": [],
          "execution_count": 1
        },
        {
          "cell_type": "markdown",
          "source": "# 分析結果"
        }
      ],
      "metadata": {
        "kernel": "python3"
      }
    },
    "modified_at": "2024-01-15T10:00:00Z"
  }
}
```

#### PUT /api/contents/{path}

ファイルまたはノートブックを更新する。

**リクエスト:**
```json
{
  "content": {
    "cells": [...]
  }
}
```

#### PATCH /api/contents/{path}/cells

セルを追加・更新する。

**リクエスト（セル追加）:**
```json
{
  "action": "add",
  "cell": {
    "cell_type": "code",
    "source": "print('Hello')"
  },
  "index": 2
}
```

**リクエスト（セル更新）:**
```json
{
  "action": "update",
  "index": 0,
  "cell": {
    "source": "import pandas as pd\nimport numpy as np"
  }
}
```

**リクエスト（セル削除）:**
```json
{
  "action": "delete",
  "index": 1
}
```

### ヘルスチェック

#### GET /health

**レスポンス:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "kernels_active": 2
}
```

---

## document-server API

ベースURL: `http://localhost:3002`

### テーブル一覧

#### GET /api/v1/tables

テーブル一覧を取得する（概要のみ）。

**クエリパラメータ:**
- `tag` - タグでフィルタ（オプション）
- `limit` - 取得件数（デフォルト: 100）
- `offset` - オフセット（デフォルト: 0）

**レスポンス:**
```json
{
  "data": {
    "tables": [
      {
        "name": "sales_transactions",
        "display_name": "売上トランザクション",
        "description": "日次の売上データ。店舗別、商品別の売上金額と数量を記録。",
        "tags": ["売上", "トランザクション", "日次"],
        "row_count": 5000000
      },
      {
        "name": "stores",
        "display_name": "店舗マスタ",
        "description": "店舗の基本情報。地域、店舗タイプ等を管理。",
        "tags": ["マスタ", "店舗"],
        "row_count": 500
      }
    ],
    "total": 15
  }
}
```

### テーブル詳細

#### GET /api/v1/tables/{name}

テーブルの詳細情報を取得する。

**レスポンス:**
```json
{
  "data": {
    "name": "sales_transactions",
    "display_name": "売上トランザクション",
    "description": "日次の売上データ。店舗別、商品別の売上金額と数量を記録。毎日午前2時にバッチ処理で更新される。",
    "datasource": "main_db",
    "schema": "public",
    "tags": ["売上", "トランザクション", "日次"],
    "row_count": 5000000,
    "columns": [
      {
        "name": "id",
        "type": "bigint",
        "description": "トランザクションID",
        "primary_key": true,
        "nullable": false
      },
      {
        "name": "store_id",
        "type": "integer",
        "description": "店舗ID",
        "nullable": false,
        "foreign_key": {
          "table": "stores",
          "column": "id"
        }
      },
      {
        "name": "product_id",
        "type": "integer",
        "description": "商品ID",
        "nullable": false,
        "foreign_key": {
          "table": "products",
          "column": "id"
        }
      },
      {
        "name": "amount",
        "type": "decimal(10,2)",
        "description": "売上金額（税込）",
        "nullable": false
      },
      {
        "name": "quantity",
        "type": "integer",
        "description": "販売数量",
        "nullable": false
      },
      {
        "name": "transaction_date",
        "type": "date",
        "description": "取引日",
        "nullable": false
      }
    ],
    "sample_data": {
      "columns": ["id", "store_id", "product_id", "amount", "quantity", "transaction_date"],
      "rows": [
        [1, 101, 501, 1500.00, 3, "2024-01-15"],
        [2, 102, 502, 800.00, 1, "2024-01-15"],
        [3, 101, 503, 2200.00, 2, "2024-01-16"]
      ]
    },
    "related_tables": [
      {
        "name": "stores",
        "display_name": "店舗マスタ",
        "relation_type": "foreign_key",
        "join_condition": "sales_transactions.store_id = stores.id",
        "description": "店舗情報を取得する際に結合"
      },
      {
        "name": "products",
        "display_name": "商品マスタ",
        "relation_type": "foreign_key",
        "join_condition": "sales_transactions.product_id = products.id",
        "description": "商品情報を取得する際に結合"
      },
      {
        "name": "daily_sales_summary",
        "display_name": "日次売上サマリー",
        "relation_type": "derived",
        "join_condition": null,
        "description": "このテーブルを日次集計したもの"
      }
    ],
    "notes": "分析時は transaction_date でフィルタすることを推奨。大量データのため全件取得は避けること。"
  }
}
```

### サンプルデータ

#### GET /api/v1/tables/{name}/sample

サンプルデータを取得する。

**クエリパラメータ:**
- `rows` - 取得行数（デフォルト: 5、最大: 20）

**レスポンス:**
```json
{
  "data": {
    "table_name": "sales_transactions",
    "columns": ["id", "store_id", "product_id", "amount", "quantity", "transaction_date"],
    "rows": [
      [1, 101, 501, 1500.00, 3, "2024-01-15"],
      [2, 102, 502, 800.00, 1, "2024-01-15"],
      [3, 101, 503, 2200.00, 2, "2024-01-16"],
      [4, 103, 501, 1000.00, 2, "2024-01-16"],
      [5, 101, 504, 3500.00, 5, "2024-01-17"]
    ],
    "total_rows": 5
  }
}
```

### 関連テーブル

#### GET /api/v1/tables/{name}/related

関連テーブルを取得する。

**レスポンス:**
```json
{
  "data": {
    "table_name": "sales_transactions",
    "related_tables": [
      {
        "name": "stores",
        "display_name": "店舗マスタ",
        "relation_type": "foreign_key",
        "join_condition": "sales_transactions.store_id = stores.id",
        "description": "店舗情報を取得する際に結合"
      },
      {
        "name": "products",
        "display_name": "商品マスタ",
        "relation_type": "foreign_key",
        "join_condition": "sales_transactions.product_id = products.id",
        "description": "商品情報を取得する際に結合"
      }
    ]
  }
}
```

### 接続情報

#### GET /api/v1/tables/{name}/connection

DB接続情報を取得する。

**レスポンス:**
```json
{
  "data": {
    "table_name": "sales_transactions",
    "datasource": {
      "id": "main_db",
      "name": "基幹データベース",
      "type": "postgresql"
    },
    "schema": "public",
    "full_table_name": "public.sales_transactions",
    "connection": {
      "host": "db.example.com",
      "port": 5432,
      "database": "sales_db",
      "user": "analyst",
      "password": "***"
    },
    "connection_string_template": "postgresql://{user}:{password}@{host}:{port}/{database}",
    "environment_variable": "MAIN_DB_URL",
    "code_examples": {
      "sqlalchemy": "from sqlalchemy import create_engine\nimport os\n\nengine = create_engine(os.environ['MAIN_DB_URL'])",
      "pandas": "import pandas as pd\nimport os\nfrom sqlalchemy import create_engine\n\nengine = create_engine(os.environ['MAIN_DB_URL'])\ndf = pd.read_sql('SELECT * FROM public.sales_transactions LIMIT 1000', engine)"
    }
  }
}
```

### 検索

#### GET /api/v1/search

キーワードでテーブルを検索する。

**クエリパラメータ:**
- `q` - 検索キーワード（必須）
- `limit` - 取得件数（デフォルト: 10）

**レスポンス:**
```json
{
  "data": {
    "query": "売上 地域",
    "results": [
      {
        "name": "regional_sales_summary",
        "display_name": "地域別売上サマリー",
        "description": "地域ごとの売上集計データ。",
        "tags": ["売上", "地域", "集計"],
        "row_count": 500,
        "score": 0.95,
        "matched_in": ["display_name", "tags"]
      },
      {
        "name": "sales_transactions",
        "display_name": "売上トランザクション",
        "description": "日次の売上データ。",
        "tags": ["売上", "トランザクション"],
        "row_count": 5000000,
        "score": 0.72,
        "matched_in": ["tags"]
      }
    ],
    "total": 2
  }
}
```

### タグ

#### GET /api/v1/tags

タグ一覧を取得する。

**レスポンス:**
```json
{
  "data": {
    "tags": [
      {"name": "売上", "count": 5},
      {"name": "マスタ", "count": 8},
      {"name": "日次", "count": 3},
      {"name": "集計", "count": 4},
      {"name": "トランザクション", "count": 2}
    ]
  }
}
```

#### GET /api/v1/tags/{tag}/tables

指定タグを持つテーブル一覧を取得する。

**レスポンス:**
```json
{
  "data": {
    "tag": "売上",
    "tables": [
      {
        "name": "sales_transactions",
        "display_name": "売上トランザクション",
        "description": "日次の売上データ。",
        "tags": ["売上", "トランザクション", "日次"]
      },
      {
        "name": "daily_sales_summary",
        "display_name": "日次売上サマリー",
        "description": "日次の売上集計。",
        "tags": ["売上", "集計", "日次"]
      }
    ],
    "total": 2
  }
}
```

### 管理

#### POST /api/v1/admin/reload

カタログを再読み込みする。

**レスポンス:**
```json
{
  "data": {
    "status": "reloaded",
    "tables_loaded": 15,
    "datasources_loaded": 2,
    "reload_time_ms": 120
  }
}
```

### ヘルスチェック

#### GET /health

**レスポンス:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "catalog": {
    "tables": 15,
    "datasources": 2,
    "last_reload": "2024-01-15T10:00:00Z"
  }
}
```

---

## エラーコード一覧

### jupyter-server

| コード | 説明 |
|--------|------|
| `KERNEL_NOT_FOUND` | 指定されたカーネルが見つからない |
| `KERNEL_DEAD` | カーネルが停止している |
| `EXECUTION_TIMEOUT` | コード実行がタイムアウト |
| `EXECUTION_ERROR` | コード実行中にエラー発生 |
| `NOTEBOOK_NOT_FOUND` | ノートブックが見つからない |
| `INVALID_CELL_INDEX` | セルインデックスが不正 |

### document-server

| コード | 説明 |
|--------|------|
| `TABLE_NOT_FOUND` | 指定されたテーブルが見つからない |
| `DATASOURCE_NOT_FOUND` | データソースが見つからない |
| `CATALOG_LOAD_ERROR` | カタログ読み込みエラー |
| `SEARCH_ERROR` | 検索処理エラー |
