# document-mcp

生成AIがデータカタログを参照するためのMCPサーバー。

## 概要

- document-server のREST APIをラップ
- 2段階アプローチでコンテキストを効率的に使用
  - 第1段階: 概要取得（軽量）
  - 第2段階: 詳細取得（必要なテーブルのみ）

## 技術スタック

- TypeScript
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- axios（HTTPクライアント）

## ディレクトリ構成

```
document-mcp/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── tools/
│   │   ├── list-summaries.ts
│   │   ├── get-details.ts
│   │   ├── get-tags.ts
│   │   └── connection.ts
│   ├── document-client/
│   │   ├── client.ts
│   │   └── types.ts
│   └── utils/
│       └── code-generator.ts
└── tests/
```

## コマンド

```bash
# 依存関係インストール
npm install

# 開発（ホットリロード）
npm run dev

# ビルド
npm run build

# 本番起動
npm start

# テスト
npm test

# 型チェック
npm run typecheck
```

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `DOCUMENT_SERVER_URL` | document-serverのURL | http://localhost:3002 |
| `MCP_PORT` | MCPサーバーポート | 3003 |
| `LOG_LEVEL` | ログレベル | info |

## MCPツール一覧

| ツール | 段階 | 説明 |
|--------|------|------|
| `list_table_summaries` | 第1段階 | 全テーブルの概要を取得 |
| `get_tags` | 第1段階 | タグ一覧を取得 |
| `get_table_details` | 第2段階 | 指定テーブルの全情報を取得 |
| `get_connection_info` | 第2段階 | DB接続コードを取得 |

## 2段階アプローチ

```
1. list_table_summaries で全テーブル概要を取得
   → カラム情報なし、軽量
   → AIがどのテーブルを使うか判断

2. get_table_details で必要なテーブルのみ詳細取得
   → カラム定義、サンプルデータ、関連テーブル
   → 複数テーブルを一度に取得可能
```

**メリット:**
- コンテキストを効率的に使用
- 不要なテーブル情報でトークンを消費しない

## 要件定義

詳細は [docs/requirements/document-mcp.md](../docs/requirements/document-mcp.md) を参照。

## 依存関係

- document-server が起動していること
