# jupyter-mcp

生成AIがJupyter環境を操作するためのMCPサーバー。

## 概要

- jupyter-server のREST APIをラップ
- MCPツールとして提供
- セッション管理、コード実行、画像参照
- `get_image` ツールで画像をビジョン分析用に取得可能

## 技術スタック

[docs/requirements/jupyter-mcp.md](../docs/requirements/jupyter-mcp.md) を参照。

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

| 変数 | 説明 |
|------|------|
| `JUPYTER_SERVER_URL` | jupyter-serverのURL |
| `JUPYTER_TOKEN` | jupyter-server認証トークン |
| `MCP_PORT` | MCPサーバーポート |
| `LOG_LEVEL` | ログレベル |

## MCPツール一覧

ツールの一覧と入出力スキーマは `src/tools/index.ts`（登録・`registerTools` / `handleToolCall`）と `src/tools/*.ts`（各ツール定義）が正。機能要件との対応は [docs/requirements/jupyter-mcp.md](../docs/requirements/jupyter-mcp.md) のツール一覧表を参照。

## 要件定義

詳細は [docs/requirements/jupyter-mcp.md](../docs/requirements/jupyter-mcp.md) を参照。

## 依存関係

- jupyter-server が起動していること
