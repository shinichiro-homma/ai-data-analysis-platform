# document-mcp 要件定義

## 概要

生成AIがデータカタログを参照するためのMCPサーバー。document-serverのREST APIをラップし、MCPツールとして提供する。

生成AIが「どのテーブルを使えばいいか」を判断するための情報を提供する。

## 機能要件

### F1: カタログ概要取得（第1段階）

コンテキストを圧迫しないよう、軽量な概要情報のみを返却する。

#### F1.1: 全テーブル概要一覧
- カタログ内の全テーブルの概要を取得
- 返却情報: テーブル名、表示名、説明（短縮版）、タグ
- カラム情報やサンプルデータは含まない

#### F1.2: タグ一覧
- 利用可能なタグの一覧を取得
- 各タグに紐づくテーブル数を含む

### F2: カタログ詳細取得（第2段階）

利用すべきテーブルが特定できたら、全量情報を取得する。

#### F2.1: テーブル詳細取得
- 指定テーブルのカタログ情報を全量取得
- カラム定義、サンプルデータ、関連テーブル、注意事項を含む
- 複数テーブルを一度に取得可能

#### F2.2: 接続情報取得
- テーブルが存在するDBへの接続情報を取得
- jupyter-serverでのコード生成に使用

## MCPツール定義

### list_table_summaries（第1段階：概要取得）

全テーブルの概要一覧を取得する。最初にカタログ全体を把握するために使用。

```typescript
{
  name: "list_table_summaries",
  description: "カタログ内の全テーブルの概要一覧を取得します。どんなデータがあるか全体像を把握する際に、最初に呼び出してください。カラム情報やサンプルデータは含まれません。",
  inputSchema: {
    type: "object",
    properties: {
      tag: {
        type: "string",
        description: "タグでフィルタ（オプション）"
      }
    }
  }
}
```

**戻り値:**
```json
{
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
    },
    {
      "name": "products",
      "display_name": "商品マスタ",
      "description": "商品の基本情報。カテゴリ、価格等を管理。",
      "tags": ["マスタ", "商品"],
      "row_count": 10000
    }
  ],
  "total": 3
}
```

**設計意図:**
- コンテキストを圧迫しないよう、カラム情報・サンプルデータは含まない
- description は概要のみ（詳細な notes は含まない）
- AIが全体を俯瞰してどのテーブルを使うか判断できる

### get_tags（第1段階：補助）

利用可能なタグ一覧を取得する。

```typescript
{
  name: "get_tags",
  description: "カタログで使用されているタグの一覧を取得します。タグで絞り込む際の参考にしてください。",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
```

**戻り値:**
```json
{
  "tags": [
    { "name": "売上", "count": 5 },
    { "name": "マスタ", "count": 8 },
    { "name": "日次", "count": 3 },
    { "name": "集計", "count": 4 }
  ]
}
```

### get_table_details（第2段階：詳細取得）

テーブルのカタログ情報を全量取得する。利用するテーブルが決まった後に使用。

```typescript
{
  name: "get_table_details",
  description: "指定テーブルのカタログ情報を全量取得します。カラム定義、サンプルデータ、関連テーブル、注意事項が含まれます。list_table_summaries で利用するテーブルの目星をつけた後に呼び出してください。",
  inputSchema: {
    type: "object",
    properties: {
      table_names: {
        type: "array",
        items: { type: "string" },
        description: "取得するテーブル名のリスト"
      }
    },
    required: ["table_names"]
  }
}
```

**戻り値（単一テーブル指定時）:**
```json
{
  "tables": [
    {
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
          "foreign_key": {
            "table": "stores",
            "column": "id"
          },
          "nullable": false
        },
        {
          "name": "product_id",
          "type": "integer",
          "description": "商品ID",
          "foreign_key": {
            "table": "products",
            "column": "id"
          },
          "nullable": false
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
          "description": "このテーブルを日次集計したもの。集計済みデータが必要な場合はこちらを使用"
        }
      ],
      "notes": "分析時は transaction_date でフィルタすることを推奨。大量データのため全件取得は避けること。"
    }
  ]
}
```

**戻り値（複数テーブル指定時）:**
```json
{
  "tables": [
    {
      "name": "sales_transactions",
      "display_name": "売上トランザクション",
      ...
    },
    {
      "name": "stores",
      "display_name": "店舗マスタ",
      ...
    }
  ]
}
```

**設計意図:**
- 複数テーブルを一度に取得可能（APIコール削減）
- カラム定義、サンプルデータ、関連テーブル、notes を全て含む
- 分析に必要な情報が全て揃う

### get_connection_info（第2段階：コード生成用）

DB接続情報を取得する。

```typescript
{
  name: "get_connection_info",
  description: "テーブルが存在するデータベースへの接続情報を取得します。pandasやSQLAlchemyでデータを読み込むコードを生成する際に使用してください。",
  inputSchema: {
    type: "object",
    properties: {
      table_name: {
        type: "string",
        description: "テーブル名"
      }
    },
    required: ["table_name"]
  }
}
```

**戻り値:**
```json
{
  "table_name": "sales_transactions",
  "datasource": "main_db",
  "type": "postgresql",
  "schema": "public",
  "connection_code": {
    "sqlalchemy": "from sqlalchemy import create_engine\nengine = create_engine(os.environ['MAIN_DB_URL'])",
    "pandas": "import pandas as pd\ndf = pd.read_sql('SELECT * FROM public.sales_transactions', engine)"
  },
  "environment_variable": "MAIN_DB_URL",
  "notes": "接続文字列は環境変数 MAIN_DB_URL から取得してください"
}
```

## 非機能要件

### NF1: パフォーマンス

| 項目 | 要件 |
|------|------|
| ツール応答時間 | document-server応答 + 50ms以内 |

### NF2: エラーハンドリング

- document-serverへの接続エラーを適切にハンドリング
- テーブルが見つからない場合は明確なメッセージを返却

### NF3: ログ

- 全ツール呼び出しをログ出力
- 検索クエリを記録（分析改善のため）

## 技術仕様

### 技術スタック

- TypeScript
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- axios または fetch（HTTP クライアント）

### ディレクトリ構成

```
document-mcp/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # エントリーポイント
│   ├── server.ts             # MCPサーバー定義
│   ├── tools/                # ツール実装
│   │   ├── search.ts
│   │   ├── tables.ts
│   │   └── connection.ts
│   ├── document-client/      # document-server APIクライアント
│   │   ├── client.ts
│   │   └── types.ts
│   └── utils/
│       └── code-generator.ts # 接続コード生成
└── tests/
    └── ...
```

### 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `DOCUMENT_SERVER_URL` | document-serverのURL | http://localhost:3002 |
| `MCP_PORT` | MCPサーバーポート | 3003 |
| `LOG_LEVEL` | ログレベル | info |

### 起動コマンド

```bash
# 開発
npm run dev

# 本番
npm run build && npm start
```

## 受け入れ条件

### AC1: 概要取得（第1段階）
- [ ] list_table_summaries で全テーブルの概要が取得できる
- [ ] 概要にはカラム情報・サンプルデータが含まれない
- [ ] タグでフィルタできる
- [ ] get_tags でタグ一覧が取得できる

### AC2: 詳細取得（第2段階）
- [ ] get_table_details で指定テーブルの全情報が取得できる
- [ ] カラム定義、サンプルデータ、関連テーブル、notesが含まれる
- [ ] 複数テーブルを一度に取得できる

### AC3: 接続情報
- [ ] get_connection_info で接続情報が取得できる
- [ ] pandas/SQLAlchemyのコード例が含まれる

### AC4: MCPプロトコル
- [ ] MCP Inspector で全ツールが表示される
- [ ] Claude Desktop から接続して操作できる

## 依存関係

- document-server が起動していること

## AIエージェント向けの使用ガイドライン

このMCPサーバーを使用するAIエージェントは、以下の2段階アプローチでツールを使用することを推奨:

### 基本フロー：概要 → 詳細 → 分析

```
【第1段階：全体把握】
1. list_table_summaries でカタログ全体の概要を取得
2. 概要を見て、分析に必要なテーブルを特定

【第2段階：詳細取得】
3. get_table_details で必要なテーブルの詳細を取得
   - 複数テーブルが必要な場合はまとめて取得
4. カラム定義、サンプルデータ、関連テーブルを確認

【分析実行】
5. get_connection_info で接続コードを取得
6. jupyter-mcp でコードを実行
```

### 具体例：「地域別の売上を分析して」

```
1. list_table_summaries を呼び出し
   → 全テーブルの概要を確認
   → "sales_transactions", "stores" が必要そうと判断

2. get_table_details(["sales_transactions", "stores"]) を呼び出し
   → カラム定義を確認（store_id で結合可能）
   → サンプルデータで値の形式を確認
   → notes で「transaction_date でフィルタ推奨」を確認

3. get_connection_info("sales_transactions") を呼び出し
   → 接続コードを取得

4. jupyter-mcp で分析コードを実行
```

### ツール一覧

| ツール | 段階 | 用途 |
|--------|------|------|
| `list_table_summaries` | 第1段階 | 全テーブルの概要を取得 |
| `get_tags` | 第1段階 | タグ一覧を取得（絞り込み用） |
| `get_table_details` | 第2段階 | 指定テーブルの全情報を取得 |
| `get_connection_info` | 第2段階 | DB接続コードを取得 |

### なぜ2段階に分けるのか

**コンテキストの効率的な使用:**
- 第1段階: 全テーブルの概要（軽量）でどのデータを使うか判断
- 第2段階: 必要なテーブルのみ詳細を取得

**悪い例:**
```
❌ いきなり全テーブルの詳細を取得
   → コンテキストを大量消費
   → 不要な情報で判断が難しくなる
```

**良い例:**
```
✅ 概要で全体を把握 → 必要なテーブルのみ詳細取得
   → コンテキストを効率的に使用
   → 分析に必要な情報に集中できる
```

### ベストプラクティス

- **最初は必ず list_table_summaries から始める**
  - どんなデータがあるか全体像を把握する
  - ユーザーのリクエストに合うテーブルを見つける

- **get_table_details は必要なテーブルのみ取得する**
  - 複数テーブルが必要な場合は一度にまとめて取得
  - 不要なテーブルの詳細は取得しない

- **関連テーブルの情報を活用する**
  - get_table_details の結果に含まれる related_tables を確認
  - JOIN が必要な場合は関連テーブルも詳細を取得

- **notes を必ず確認する**
  - 大規模テーブルの注意事項
  - フィルタ条件の推奨
  - データの更新タイミング
