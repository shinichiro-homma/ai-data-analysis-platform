# jupyter-mcp

生成AIがJupyter環境を操作するためのMCPサーバー。

## 概要

- jupyter-server のREST APIをラップ
- MCPツール/リソースとして提供
- セッション管理、コード実行、画像取得

## 技術スタック

- TypeScript
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- axios（HTTPクライアント）

## ディレクトリ構成

```
jupyter-mcp/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── tools/
│   │   ├── session.ts
│   │   ├── execute.ts
│   │   ├── notebook.ts
│   │   ├── variables.ts
│   │   └── files.ts
│   ├── resources/
│   │   └── images.ts
│   ├── jupyter-client/
│   │   ├── client.ts
│   │   └── types.ts
│   └── utils/
│       └── output-formatter.ts
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
| `JUPYTER_SERVER_URL` | jupyter-serverのURL | http://localhost:8888 |
| `JUPYTER_TOKEN` | 認証トークン | （必須） |
| `MCP_PORT` | MCPサーバーポート | 3001 |
| `LOG_LEVEL` | ログレベル | info |

## MCPツール一覧

| ツール | 説明 |
|--------|------|
| `session_create` | セッション作成 |
| `session_list` | セッション一覧 |
| `session_connect` | 既存セッションに接続 |
| `session_delete` | セッション終了 |
| `execute_code` | コード実行 |
| `get_variables` | 変数一覧 |
| `get_dataframe_info` | DataFrame詳細 |
| `notebook_create` | ノートブック作成 |
| `notebook_add_cell` | セル追加 |
| `file_list` | ファイル一覧 |
| `get_image_resource` | 画像取得 |

## MCPリソース

```
jupyter://sessions/{session_id}/images/{image_id}.png
```

コード実行で生成された画像をリソースとして提供。

## 要件定義

詳細は [docs/requirements/jupyter-mcp.md](../docs/requirements/jupyter-mcp.md) を参照。

## 依存関係

- jupyter-server が起動していること
