# AI Data Analysis Platform

生成AIによるデータ分析を可能にするプラットフォーム。Jupyter環境での分析実行とデータカタログ管理を、MCPサーバー経由で生成AIに提供する。

## コンポーネント

| 名前 | 概要 | ポート |
|------|------|--------|
| jupyter-server | JupyterLabベースの分析実行環境 | 8888 |
| jupyter-mcp | Jupyter操作用MCPサーバー | 3001 |
| jupyterlab-ai-sync | AIリアルタイム同期JupyterLab拡張 | - (jupyter-serverに同梱) |
| document-server | データカタログ・用語集・ロジック管理API | 3002 |
| document-mcp | カタログ・用語集・ロジック参照用MCPサーバー | 3003 |

## 開発コマンド

**ビルド・テスト・Docker 操作は `scripts/` 配下のスクリプトを使う**（`npm run build` / `npm test` / `docker compose build` 等を直接実行しない）。スクリプト一覧と使い分けは `.claude/rules/scripts.md` を参照。

## 初回セットアップ

clone 後に 1 度だけ実行する：

```bash
bash scripts/bootstrap.sh
```

- uv 未インストール時はスクリプトが PATH 設定手順または [公式インストールコマンド](https://docs.astral.sh/uv/getting-started/installation/) を案内する
- `.env` は自動コピーされるが本番利用時は `POSTGRES_PASSWORD` / `JUPYTER_TOKEN` の変更が必須

## ブランチ運用

`.claude/rules/branch-workflow.md` を参照。すべての変更は `feature/*` / `fix/*` ブランチで行い、PR 経由で `dev` にマージする。

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [プロジェクト全体像](docs/overview.md) | アーキテクチャ、ユースケースフロー、データフロー |
| [ドキュメント構成マップ](docs/STRUCTURE.md) | ファイル一覧と役割、更新の依存関係、Single Source of Truth の定義 |
| [開発プラン](docs/plan/README.md) | タスク一覧と進捗管理（dev ブランチのみ） |
| [API契約](docs/design/api-contracts.md) | REST API エンドポイント一覧（詳細はコードが正） |

### 要件定義

- [jupyter-server](docs/requirements/jupyter-server.md)
- [jupyter-mcp](docs/requirements/jupyter-mcp.md)
- [jupyterlab-ai-sync](docs/requirements/jupyterlab-ai-sync.md)
- [document-server](docs/requirements/document-server.md)
- [document-mcp](docs/requirements/document-mcp.md)
