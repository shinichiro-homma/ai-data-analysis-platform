# AI Data Analysis Platform

生成AIによるデータ分析を可能にするプラットフォーム。Jupyter環境での分析実行とデータカタログ管理を、MCPサーバー経由で生成AIに提供します。

## アーキテクチャ

```
┌─────────────────┐     ┌─────────────────┐
│   AI Assistant  │     │   AI Assistant  │
└────────┬────────┘     └────────┬────────┘
         │ MCP                   │ MCP
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│   jupyter-mcp   │     │  document-mcp   │
│    (port 3001)  │     │   (port 3003)   │
└────────┬────────┘     └────────┬────────┘
         │ HTTP                  │ HTTP
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ jupyter-server  │     │ document-server │
│    (port 8888)  │     │   (port 3002)   │
└─────────────────┘     └─────────────────┘
```

## コンポーネント

| 名前 | 概要 | ポート |
|------|------|--------|
| jupyter-server | JupyterLabベースの分析実行環境 | 8888 |
| jupyter-mcp | Jupyter操作用MCPサーバー | 3001 |
| document-server | データカタログ管理API | 3002 |
| document-mcp | カタログ参照用MCPサーバー | 3003 |

## セットアップ

### 必要条件

- Docker & Docker Compose
- Node.js 20+
- Python 3.11+

### 起動方法

```bash
# 全体起動
docker-compose up -d

# 個別起動（各ディレクトリ内で）
npm run dev        # MCPサーバー
jupyter lab        # jupyter-server
```

## ドキュメント

- [プロジェクト全体像](docs/overview.md)
- [開発プラン](docs/PLAN.md)
- [API仕様](docs/design/api-contracts.md)

### 要件定義

- [jupyter-server](docs/requirements/jupyter-server.md)
- [jupyter-mcp](docs/requirements/jupyter-mcp.md)
- [document-server](docs/requirements/document-server.md)
- [document-mcp](docs/requirements/document-mcp.md)

## ライセンス

MIT
