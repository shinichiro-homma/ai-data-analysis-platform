# API仕様

jupyter-mcp ↔ jupyter-server、document-mcp ↔ document-server 間のREST API仕様を定義する。

## 共通仕様

### リクエスト形式

- Content-Type: `application/json`
- 認証: `Authorization: Bearer {token}` ヘッダー（jupyter-server は Jupyter Server 標準のトークン認証で実装済み。document-server は認証未実装、信頼されたネットワーク内での運用を前提）

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

実行中のコードを中断する。JupyterLab UI 用の内部 API であり、MCP ツールとしては公開しない。

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

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| code | string | Yes | 実行するPythonコード |
| timeout | number | No | タイムアウト秒数（デフォルト30秒、最大300秒） |

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
        "file_path": "workspaces/ws-abc123/output/exec-2-img-001.png",
        "mime_type": "image/png",
        "description": "matplotlib output [1]"
      }
    ],
    "execution_time_ms": 1200
  }
}
```

> `images` の各要素: `file_path` は `workspaces/{workspace_id}/output/exec-{N}-img-{NNN}.{ext}` 形式。ファイル名には実行カウントが含まれ、実行間でのファイル名衝突を回避する。画像は jupyter-server が `display_data` メッセージ受信時にワークスペースの `output/` にファイルとして保存する。base64データはレスポンスに含めない。

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

#### GET /api/custom/contents

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

#### POST /api/custom/contents

ノートブックまたはファイルを作成する。同名ファイルが既に存在する場合、自動連番（`{name}_2`, `{name}_3`, ...）を付与して別名で作成する。既存ファイルは上書きしない。

**リクエスト（ノートブック）:**
```json
{
  "type": "notebook",
  "path": "/analysis.ipynb"
}
```

**レスポンス（新規作成）:**
```json
{
  "data": {
    "path": "/analysis.ipynb",
    "type": "notebook",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

**レスポンス（同名ファイル存在時 — 自動連番）:**
```json
{
  "data": {
    "path": "/analysis_2.ipynb",
    "type": "notebook",
    "created_at": "2024-01-15T10:01:00Z"
  }
}
```

**注:** レスポンスの `path` は実際に作成されたファイルのパスを返す。リクエストで指定した `path` と異なる場合がある。

#### POST /api/custom/contents/{path}

指定パスにファイルまたはノートブックを作成する。既存ファイルがある場合は上書きする。

**リクエスト（ノートブック）:**
```json
{
  "content": {
    "cells": [
      {
        "cell_type": "code",
        "source": "import pandas as pd"
      }
    ]
  }
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

#### GET /api/custom/contents/{path}

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

#### PUT /api/custom/contents/{path}

ファイルまたはノートブックを更新する。

**リクエスト:**
```json
{
  "content": {
    "cells": [...]
  }
}
```

#### GET /api/custom/contents/{path}/cells

ノートブックの全セル一覧を取得する。

**レスポンス:**
```json
{
  "data": {
    "path": "/analysis.ipynb",
    "cells": [
      {
        "cell_index": 0,
        "cell_type": "code",
        "source": "import pandas as pd",
        "outputs": [],
        "execution_count": 1
      },
      {
        "cell_index": 1,
        "cell_type": "markdown",
        "source": "# 分析結果"
      }
    ],
    "total_cells": 2
  }
}
```

**エラー:**
- `400 VALIDATION_ERROR` - ノートブック以外のファイル（.py 等）を指定した場合
- `404 NOT_FOUND` - ファイルが存在しない場合

#### PATCH /api/custom/contents/{path}/cells

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
    "source": "import pandas as pd\nimport numpy as np",
    "outputs": [...],
    "execution_count": 1
  }
}
```

**セル更新時の `cell` フィールド:**
- `source`: セルのソースコード（オプション）
- `cell_type`: セルタイプ（オプション）
- `outputs`: セルの出力（オプション、コードセルのみ）
- `execution_count`: 実行カウント（オプション、コードセルのみ）

**注:** セル更新時は、指定したフィールドのみが更新されます。指定しないフィールドは変更されません。

**リクエスト（セル削除）:**
```json
{
  "action": "delete",
  "index": 1
}
```

**リクエスト（セル並び替え）:**
```json
{
  "action": "reorder",
  "index": 2,
  "to_index": 0
}
```

`index` のセルを pop した後のリストに対して `to_index` の位置に insert する。
`index == to_index` の場合はノーオプとして正常終了する。

#### POST /api/custom/contents/{path}/cells/{index}/execute

指定セルのコードをカーネルで再実行し、セルの出力と実行回数を更新する。

**リクエスト:**
```json
{
  "kernel_id": "kernel-abc123",
  "timeout": 30
}
```

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| kernel_id | string | Yes | 実行に使用するカーネルID |
| timeout | number | No | タイムアウト秒数（デフォルト・最大値は `jupyter-server/extensions/custom_api/base.py` の `validate_timeout()` を参照） |

**レスポンス（成功時）:**
```json
{
  "data": {
    "cell_index": 2,
    "source": "print('Hello')",
    "execution_count": 5,
    "outputs": [
      {
        "type": "stdout",
        "text": "Hello\n"
      }
    ],
    "execution_time_ms": 150
  }
}
```

**エラー:**
- `400 VALIDATION_ERROR` - ノートブック以外のファイル、コードセル以外のセル、または範囲外のインデックスを指定した場合
- `404 NOT_FOUND` - ファイルまたはカーネルが存在しない場合

#### GET /api/custom/contents/{path}/preview

CSV/Parquetファイルの構造をプレビューする。カーネル不要で直接ファイルを読み取る。

| クエリパラメータ | 型 | 必須 | 説明 |
|-----------------|-----|------|------|
| head_rows | number | No | 先頭行数（デフォルト5、最大50） |

**レスポンス:**
```json
{
  "data": {
    "path": "/workspaces/ws-abc123/data/sales.csv",
    "format": "csv",
    "columns": [
      { "name": "id", "dtype": "int64" },
      { "name": "name", "dtype": "object" },
      { "name": "amount", "dtype": "float64" }
    ],
    "row_count": 1000,
    "head": [
      { "id": 1, "name": "Product A", "amount": 100.5 }
    ],
    "file_size_bytes": 204800
  }
}
```

**エラー:**
- `400 UNSUPPORTED_FORMAT` - `.csv`/`.parquet` 以外のファイル
- `404 NOT_FOUND` - ファイルが存在しない

### SQL実行

#### POST /api/sql/execute

SQL命令を実行する。SELECT文の場合は結果をCSVファイルとしてワークスペースの `data/` ディレクトリに保存する。危険な操作（DELETE, ALTER, GRANT, REVOKE, VACUUM, ANALYZE, CREATE TABLE非TEMP, CREATE/DROP INDEX等）はブラックリスト方式で拒否する。CREATE/DROP は後続トークンで安全性を判定し、TEMP TABLE / FUNCTION のみ許可する。

**リクエスト:**
```json
{
  "sql": "SELECT customer_id, transaction_date, amount FROM purchase_history WHERE status = 'completed' LIMIT 1000",
  "workspace_id": "ws-abc123",
  "filename": "transactions.csv",
  "timeout": 30,
  "max_rows": 100000
}
```

**レスポンス（成功時）:**
```json
{
  "data": {
    "success": true,
    "file_path": "workspaces/ws-abc123/data/transactions.csv",
    "row_count": 1000,
    "columns": ["customer_id", "transaction_date", "amount"],
    "file_size_bytes": 32768,
    "execution_time_ms": 250,
    "truncated": true
  }
}
```

**レスポンス（成功 — 非SELECT文: DDL/DML/トランザクション系）:**
```json
{
  "data": {
    "success": true,
    "affected_rows": 100,
    "execution_time_ms": 50
  }
}
```

> 非SELECT文はCSV保存を行わないため、`file_path`, `columns`, `file_size_bytes`, `truncated` は含まれない。`affected_rows` はDML文（INSERT/UPDATE）の場合に影響行数を返却する。DDL/トランザクション系は `affected_rows: 0` を返却する。

**レスポンス（エラー — 禁止されたSQL文）:**
```json
{
  "error": {
    "code": "SQL_NOT_ALLOWED",
    "message": "DELETE statements are not allowed."  // ALTER, GRANT, REVOKE, VACUUM, ANALYZE, CREATE TABLE(非TEMP), CREATE/DROP INDEX 等も同様に拒否
  }
}
```

**レスポンス（エラー — クエリエラー）:**
```json
{
  "error": {
    "code": "SQL_EXECUTION_ERROR",
    "message": "SQL execution failed. Check your query syntax."
  }
}
```

**レスポンス（エラー — DB接続エラー）:**
```json
{
  "error": {
    "code": "DATABASE_CONNECTION_ERROR",
    "message": "Could not connect to database. Check DATABASE_URL configuration."
  }
}
```

**レスポンス（エラー — タイムアウト）:**
```json
{
  "error": {
    "code": "SQL_TIMEOUT",
    "message": "Query execution timed out after 30 seconds"
  }
}
```

#### POST /api/sql/export

SQLクエリの結果をワークスペースの `data/` ディレクトリにParquet/CSVファイルとして直接書き出す。ストリーミング処理（チャンク単位）でメモリ使用量を一定に抑える。行数制限なし。SELECT文のみ対応。

**リクエスト:**
```json
{
  "sql": "SELECT customer_id, transaction_date, amount FROM purchase_history WHERE status = 'completed'",
  "workspace_id": "ws-abc123",
  "filename": "purchase_history.parquet",
  "format": "parquet",
  "timeout": 300
}
```

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| sql | string | Yes | 実行するSELECT文 |
| workspace_id | string | Yes | ワークスペースID |
| filename | string | Yes | 保存先ファイル名（data/ディレクトリ内） |
| format | string | No | 出力形式（"parquet" / "csv"、デフォルト: "parquet"） |
| timeout | number | No | タイムアウト秒数（デフォルト300秒、最大600秒） |

**レスポンス（成功時）:**
```json
{
  "data": {
    "success": true,
    "file_path": "workspaces/ws-abc123/data/purchase_history.parquet",
    "row_count": 5000000,
    "file_size_bytes": 104857600,
    "format": "parquet",
    "execution_time_ms": 15000
  }
}
```

**レスポンス（エラー — 非SELECT文）:**
```json
{
  "error": {
    "code": "SQL_NOT_ALLOWED",
    "message": "Only SELECT statements are allowed for export"
  }
}
```

**レスポンス（エラー — ファイル書き出し失敗）:**
```json
{
  "error": {
    "code": "FILE_WRITE_ERROR",
    "message": "Failed to write export file: /path/to/file"
  }
}
```

> エラーコード `SQL_EXECUTION_ERROR`, `SQL_TIMEOUT`, `DATABASE_CONNECTION_ERROR`, `DATABASE_NOT_CONFIGURED` は `POST /api/sql/execute` と共通。

### ワークスペース管理

#### POST /api/workspaces

ワークスペース（チャット独立の作業ディレクトリ）を作成する。

**リクエスト:**
```json
{
  "name": "売上分析",
  "summary": "売上データのトレンド分析",
  "status": "not_started"
}
```

> `summary`（最大200文字）と `status`（`not_started` / `in_progress` / `completed` / `blocked`）はオプション。省略時はそれぞれ空文字列、`not_started`。

**レスポンス:**
```json
{
  "data": {
    "workspace_id": "ws-abc123",
    "name": "売上分析",
    "summary": "売上データのトレンド分析",
    "status": "not_started",
    "path": "workspaces/ws-abc123",
    "data_path": "data",
    "output_path": "output",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

> **パス形式:** `path` はサーバーベースディレクトリからの相対パス。`data_path` / `output_path` はカーネルの作業ディレクトリ（ワークスペースディレクトリ）からの相対パスで、カーネル内のコードでそのまま使用可能（例: `open('data/input.csv')`）。

#### GET /api/workspaces

既存のワークスペース一覧を取得する。

**レスポンス:**
```json
{
  "data": {
    "workspaces": [
      {
        "workspace_id": "ws-abc123",
        "name": "売上分析",
        "summary": "売上データのトレンド分析",
        "status": "in_progress",
        "path": "workspaces/ws-abc123",
        "data_path": "data",
        "output_path": "output",
        "created_at": "2024-01-15T10:00:00Z",
        "file_count": 3
      },
      {
        "workspace_id": "ws-def456",
        "name": "顧客分析",
        "summary": "",
        "status": "not_started",
        "path": "workspaces/ws-def456",
        "data_path": "data",
        "output_path": "output",
        "created_at": "2024-01-16T09:00:00Z",
        "file_count": 1
      }
    ]
  }
}
```

#### PUT /api/workspaces/{workspace_id}

ワークスペースのメタデータ（summary, status）を更新する。

**リクエスト:**
```json
{
  "summary": "売上データのトレンド分析。前処理完了、集計中",
  "status": "in_progress"
}
```

> `summary` と `status` はどちらもオプション。指定したフィールドのみ更新される。

**レスポンス:**
```json
{
  "data": {
    "workspace_id": "ws-abc123",
    "name": "売上分析",
    "summary": "売上データのトレンド分析。前処理完了、集計中",
    "status": "in_progress",
    "path": "workspaces/ws-abc123",
    "data_path": "data",
    "output_path": "output",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

**エラー:**
- `404`: 指定された workspace_id が存在しない

#### POST /api/workspaces/{workspace_id}/summarize

ワークスペースのサマリ生成に必要なテンプレートと評価基準を返却する。AIがレポートを生成するための情報を提供する。

**リクエスト:** ボディなし

**レスポンス:**
```json
{
  "data": {
    "workspace_id": "ws-abc123",
    "template": "（SUMMARY.md テンプレート）",
    "verification_criteria": "（検証観点 A-F 定義）",
    "instructions": "string — 検証レポート作成手順の指示文"
  }
}
```

**エラー:**
- `404`: 指定された workspace_id が存在しない

### AI同期イベント

#### WS /api/ai/events

AI操作イベントをリアルタイムで配信するWebSocketエンドポイント。JupyterLab拡張（jupyterlab-ai-sync）がこのエンドポイントに接続し、AIの操作をノートブックUIに反映する。

**接続:**
```
ws://localhost:8888/api/ai/events?token={token}
```

**認証:**
- クエリパラメータ `token` で認証トークンを指定（Jupyter Server 標準のトークン認証）

#### POST /api/ai/events/broadcast

AIイベントを送信する（jupyter-mcpから呼び出される）。受信したイベントは接続中の全WebSocketクライアントにブロードキャストされる。

**リクエスト:**
```json
{
  "type": "イベントタイプ",
  "notebook_path": "analysis.ipynb",
  ...
}
```

**レスポンス:**
```json
{
  "data": {
    "broadcasted": true,
    "clients": 1
  }
}
```

#### イベントタイプ一覧

##### ai_edit_start

AI編集モード開始。ノー���ブックをロック（read-only）にする��

> **注:** このイベントは jupyter-mcp の `handleToolCall` ミドルウェアがノートブック編集系ツール実行時に自動配信する内部イベントです。独立した MCP ツールとしては提供されません���

```json
{
  "type": "ai_edit_start",
  "notebook_path": "analysis.ipynb"
}
```

##### cell_added

セル追加完了。

```json
{
  "type": "cell_added",
  "notebook_path": "analysis.ipynb",
  "cell": {
    "cell_type": "code",
    "source": "import pandas as pd\nprint('Hello')"
  },
  "index": 3
}
```

##### cell_edited

セル編集完了。対象セルの内容を更新する。

```json
{
  "type": "cell_edited",
  "notebook_path": "analysis.ipynb",
  "cell_index": 0,
  "source": "import pandas as pd\nprint('Updated')"
}
```

##### cell_deleted

セル削除完了。対象セルをノートブックから削除する。

```json
{
  "type": "cell_deleted",
  "notebook_path": "analysis.ipynb",
  "cell_index": 2
}
```

##### cell_reordered

セル並び替え完了。対象セルを指定位置に移動する。

```json
{
  "type": "cell_reordered",
  "notebook_path": "analysis.ipynb",
  "cell_index": 0,
  "to_index": 3
}
```

##### cell_execute_start

セル実行開始。対象セルに実行中スピナーを表示する。

```json
{
  "type": "cell_execute_start",
  "notebook_path": "analysis.ipynb",
  "cell_index": 3
}
```

##### cell_output

セル出力（ストリーミング）。実行中のセルに出力を追加する。

**stdout/stderr:**
```json
{
  "type": "cell_output",
  "notebook_path": "analysis.ipynb",
  "cell_index": 3,
  "output": {
    "output_type": "stream",
    "name": "stdout",
    "text": "Hello, World!\n"
  }
}
```

**画像出力:**
```json
{
  "type": "cell_output",
  "notebook_path": "analysis.ipynb",
  "cell_index": 3,
  "output": {
    "output_type": "display_data",
    "data": {
      "image/png": "iVBORw0KGgoAAAANSUhEUgAA...",
      "text/plain": "<Figure size 800x600>"
    },
    "metadata": {}
  }
}
```

**式の評価結果:**
```json
{
  "type": "cell_output",
  "notebook_path": "analysis.ipynb",
  "cell_index": 3,
  "output": {
    "output_type": "execute_result",
    "execution_count": 1,
    "data": {
      "text/plain": "42"
    },
    "metadata": {}
  }
}
```

**エラー:**
```json
{
  "type": "cell_output",
  "notebook_path": "analysis.ipynb",
  "cell_index": 3,
  "output": {
    "output_type": "error",
    "ename": "ZeroDivisionError",
    "evalue": "division by zero",
    "traceback": ["..."]
  }
}
```

##### cell_execute_end

セル実行完了。実行中スピナーを解除し、execution_countを設定する。

```json
{
  "type": "cell_execute_end",
  "notebook_path": "analysis.ipynb",
  "cell_index": 3,
  "execution_count": 1,
  "success": true
}
```

##### ai_edit_end

AI編集モード終了。ノートブックのロックを解除する。

> **注:** このイベントは jupyter-mcp の `handleToolCall` ミドルウェアがツール実行完了後に自動配信する内部イベントです。独立した MCP ツールとしては提供されません。

```json
{
  "type": "ai_edit_end",
  "notebook_path": "analysis.ipynb"
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

### テーブルインデックス

#### GET /catalog/index

全テーブルのインデックスを取得する（軽量な概要情報のみ）。

**レスポンス:**
```json
{
  "data": {
    "tables": [
      {
        "table_name": "purchase_history",
        "display_name": "購買履歴",
        "summary": "統合会員の購買トランザクションデータ。1レコード＝1購買明細。",
        "category": "トランザクション系"
      },
      {
        "table_name": "customer_master",
        "display_name": "会員マスタ",
        "summary": "統合会員の基本情報を管理するマスタテーブル。ロイヤルティランク、入会日、属性情報等を保持。",
        "category": "マスタ系"
      }
    ],
    "total": 2
  }
}
```

### テーブル詳細

#### POST /catalog/tables

指定テーブルの詳細情報を取得する（一括取得対応、上限は `document-server/src/models.py` の `BULK_REQUEST_MAX` を参照）。基本情報、データソース、カラム定義、基本統計量（テーブル固有の拡張統計項目を含む）、テーブルレベル注意点の5セクションで構成。

**リクエスト:**
```json
{
  "table_names": ["purchase_history", "customer_master"]
}
```

> `table_names` は1件以上。上限は `document-server/src/models.py` の `BULK_REQUEST_MAX` を参照。超えた場合はバリデーションエラー（422）。

**レスポンス:**
```json
{
  "data": {
    "tables": [
      {
        "table_name": "purchase_history",
        "display_name": "購買履歴",
        "description": "統合会員の購買トランザクションデータ。各レコードが1購買明細（1商品）に対応する。明細レベルの分析や、独自の集計軸での集計が必要な場合に使用する。",
        "data_source": {
          "type": "postgresql",
          "table": "purchase_history"
        },
        "columns": [
          {
            "name": "customer_id",
            "type": "varchar(16)",
            "description": "統合顧客ID（洗い替え後）",
            "nullable": false,
            "key_type": "統合会員番号",
            "domain": {
              "master_table": "customer_master",
              "master_column": "customer_id",
              "label_column": "customer_name"
            },
            "notes": "洗い替え後のIDを使用。洗い替え前のIDはraw_customer_idカラム。会員マスタとの結合にはこのカラムを使うこと。",
            "examples": ["MB00012345", "MB00067890"]
          },
          {
            "name": "member_code",
            "type": "varchar(20)",
            "description": "会員コード（会員種別に応じて体系が異なる）",
            "nullable": false,
            "key_types": [
              { "value": "統合会員番号", "condition": "member_type = '正会員'" },
              { "value": "仮会員番号", "condition": "member_type = '仮会員'" }
            ],
            "notes": "member_type カラムの値により、会員コード体系が異なる。"
          },
          {
            "name": "amount",
            "type": "integer",
            "description": "購買金額（税抜）",
            "nullable": false,
            "notes": "税抜金額。キャンセル済み取引もレコードとして残っているため、売上集計時は status != 'cancelled' でフィルタすること。",
            "examples": [1200, 5800, 350]
          },
          {
            "name": "status",
            "type": "varchar(16)",
            "description": "取引ステータス",
            "nullable": false,
            "domain": {
              "values": ["completed", "cancelled", "returned"]
            }
          }
        ],
        "statistics": {
          "row_count": 15000000,
          "date_range": {
            "from": "2020-01-01",
            "to": "2025-12-31"
          },
          "update_frequency": "日次バッチ",
          "additional": {
            "avg_basket_size": 3.2,
            "top_categories": ["食品", "日用品", "衣料"],
            "cancelled_rate": 0.05
          }
        },
        "notes_table_level": [
          "キャンセル済み取引もレコードとして残っている。売上集計時はstatus != 'cancelled'でフィルタすること。",
          "2022年3月以前のデータは会員ID洗い替え前のため、customer_idの一貫性に注意。"
        ]
      }
    ],
    "not_found": []
  }
}
```

**data_source のパターン:**

| type | フィールド | 説明 |
|------|-----------|------|
| `postgresql` | `table` | PostgreSQLテーブル名 |
| `csv` | `file_path`, `encoding` | CSVファイルパスとエンコーディング |
| `external` | `format`, `description` | 外部データ（DB非依存、チャットから都度提供） |

```json
// PostgreSQL型
{ "type": "postgresql", "table": "purchase_history" }

// CSV型
{ "type": "csv", "file_path": "data/sample.csv", "encoding": "utf-8" }

// 外部データ型
{ "type": "external", "format": "csv", "description": "テナントマスタ。チャットからCSV/Excelファイルとして都度提供される。" }
```

**一部のテーブルが見つからない場合:**
```json
{
  "data": {
    "tables": [
      { "table_name": "customer_master", "..." : "..." }
    ],
    "not_found": ["nonexistent_table"]
  }
}
```

### 用語インデックス

#### GET /glossary/index

用語のインデックスを取得する。オプションの query パラメータで用語名（name）、別名（aliases）、および関連用語（related_terms）を部分一致検索できる。

**クエリパラメータ:**

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `query` | 任意 | 検索キーワード（上限は `document-server/src/routers/terms.py` の `max_length` を参照）。name、aliases、related_terms を部分一致検索。省略時は全件返却 |

**レスポンス（query なし — 全件返却）:**
```json
{
  "data": {
    "terms": [
      {
        "name": "ロイヤルティランク",
        "summary": "統合会員の購買実績に基づく顧客ロイヤルティランク"
      },
      {
        "name": "統合会員ID",
        "summary": "サンプル株式会社の統合顧客ID体系"
      },
      {
        "name": "店舗",
        "summary": "各店舗の総称（東京店、大阪店等）"
      }
    ],
    "total": 3
  }
}
```

**レスポンス（query="PC" — 検索結果）:**
```json
{
  "data": {
    "terms": [
      {
        "name": "ポイントキャンペーン",
        "summary": "期間限定のポイント付与施策"
      }
    ],
    "total": 1
  }
}
```

**レスポンス（query="存在しない用語" — ヒットなし）:**
```json
{
  "data": {
    "terms": [],
    "total": 0
  }
}
```

### 用語詳細

#### POST /glossary/terms

指定用語の詳細情報を取得する（一括取得対応、上限は `document-server/src/models.py` の `BULK_REQUEST_MAX` を参照）。

**リクエスト:**
```json
{
  "term_names": ["ロイヤルティランク", "統合会員ID"]
}
```

**レスポンス:**
```json
{
  "data": {
    "terms": [
      {
        "name": "ロイヤルティランク",
        "aliases": ["ロイヤルティランク", "Loyalty Rank", "顧客ランク"],
        "definition": "統合会員の購買実績に基づく顧客ロイヤルティランク",
        "related_terms": ["統合会員ID"],
        "values": [
          { "label": "レギュラー", "description": "基本ランク" },
          { "label": "シルバー", "description": "年間購買額XX万円以上" },
          { "label": "ゴールド", "description": "年間購買額XX万円以上" },
          { "label": "プラチナ", "description": "年間購買額XX万円以上" }
        ]
      },
      {
        "name": "統合会員ID",
        "aliases": ["統合会員ID", "統合顧客ID"],
        "definition": "サンプル株式会社の統合顧客ID体系。メンバーズカード等の会員情報を統合管理",
        "related_terms": ["メンバーズカード"]
      }
    ],
    "not_found": []
  }
}
```

### ロジックインデックス

#### GET /logic/index

全ロジックのインデックスを取得する。

**レスポンス:**
```json
{
  "data": {
    "logic": [
      {
        "logic_name": "member_id_remapping",
        "summary": "統合会員IDの洗い替え処理。洗い替え前IDを最新IDに変換する。",
        "category": "前処理"
      },
      {
        "logic_name": "sales_basic_aggregation",
        "summary": "店舗別・店舗別・顧客セグメント別の売上基礎集計（買上額・買上人数）",
        "category": "集計"
      }
    ],
    "total": 2
  }
}
```

### ロジックメタ

#### POST /logic/meta

指定ロジックのメタ情報を取得する（一括取得対応、上限は `document-server/src/models.py` の `BULK_REQUEST_MAX` を参照）。

**リクエスト:**
```json
{
  "logic_names": ["member_id_remapping", "sales_basic_aggregation"]
}
```

**レスポンス:**
```json
{
  "data": {
    "logic": [
      {
        "logic_name": "member_id_remapping",
        "description": "統合会員IDの洗い替え処理。会員統合やID体系変更に伴い、旧IDを最新のIDに変換する前処理。",
        "file_path": "logic/code/sql/member_id_remapping.sql",
        "language": "sql",
        "usage_type": "template",
        "input_tables": ["purchase_history", "member_id_mapping"],
        "output_description": "洗い替え後のcustomer_idを持つトランザクションデータ",
        "usage_context": "購買データを使った分析の前処理として、ほぼ全ての分析で最初に適用する。",
        "related_logic": ["sales_basic_aggregation"],
        "notes": "洗い替えマッピングテーブルは月次で更新される。最新のmapping_dateのレコードを使うこと。"
      }
    ],
    "not_found": []
  }
}
```

### ロジックコード

#### GET /logic/code/{logic_name}

指定ロジックのコードファイル内容を取得する。`logic_name` のバリデーション（許可文字パターン・最大長）は `document-server/src/routers/logic.py` のパスパラメータ定義を参照。

**レスポンス:**
```json
{
  "data": {
    "logic_name": "member_id_remapping",
    "language": "sql",
    "code": "SELECT \n  COALESCE(m.new_member_id, t.customer_id) AS customer_id,\n  t.*\nFROM purchase_history t\nLEFT JOIN member_id_mapping m\n  ON t.customer_id = m.old_member_id\nWHERE m.mapping_date = (SELECT MAX(mapping_date) FROM member_id_mapping)"
  }
}
```

### 管理

#### POST /admin/reload

カタログ・用語集・ロジックを再読み込みする。

**レスポンス:**
```json
{
  "data": {
    "status": "reloaded",
    "tables_loaded": 15,
    "terms_loaded": 20,
    "logic_loaded": 5,
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
    "terms": 20,
    "logic": 5,
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
| `AI_SYNC_NO_CLIENTS` | AI同期WebSocketに接続中のクライアントがいない |
| `WORKSPACE_NOT_FOUND` | 指定されたワークスペースが見つからない |
| `SQL_NOT_ALLOWED` | 禁止SQL文（DELETE, ALTER, GRANT, REVOKE, VACUUM, ANALYZE, TRUNCATE, COPY, CREATE TABLE非TEMP, CREATE/DROP INDEX等）が指定された |
| `CODE_NOT_ALLOWED` | AST検査で禁止されたPythonコード（シェルコマンド実行等）が検出された |
| `INVALID_FILE_PATH` | エクスポート先ファイル名のバリデーションエラー |
| `SQL_EXECUTION_ERROR` | SQLクエリの実行エラー |
| `SQL_TIMEOUT` | SQLクエリの実行がタイムアウト |
| `DATABASE_CONNECTION_ERROR` | データベースへの接続エラー |
| `DATABASE_NOT_CONFIGURED` | DATABASE_URLが設定されていない |
| `FILE_WRITE_ERROR` | エクスポートファイルの書き出しに失敗 |
| `UNSUPPORTED_FORMAT` | CSV/Parquet以外のファイル形式が指定された |

### document-server

| コード | 説明 |
|--------|------|
| `LOGIC_NOT_FOUND` | 指定されたロジックが見つからない |
| `LOGIC_CODE_NOT_FOUND` | 指定されたロジックのコードファイルが見つからない |
| `CATALOG_LOAD_ERROR` | カタログ読み込みエラー |
| `INTERNAL_ERROR` | サーバー内部エラー |
