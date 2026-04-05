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

```bash
# 全体起動
docker-compose up -d

# 個別起動（各ディレクトリ内で）
npm run dev        # MCPサーバー
jupyter lab        # jupyter-server
```

## ブランチ運用

```
main (公開・リリース済み、直接 push 禁止)
 └── dev (統合・検証用、直接 push 禁止)
      └── feature/xxx ← dev から切る
```

- すべての作業は `feature/*` または `fix/*` ブランチで行う（ドキュメントのみの変更も含む）
- `main` / `dev` への直接 push は GitHub ブランチ保護で拒否される
- `main` への直接コミットはローカルフック（`block-main-commit.sh`）でもブロックされる
- PR マージには CI（4 ジョブ）のパスが必須
- main へのリリース: `scripts/promote-to-main.sh`（dev ブランチで実行）

詳細は `.claude/rules/branch-workflow.md` を参照。

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [プロジェクト全体像](docs/overview.md) | アーキテクチャ、ユースケースフロー、データフロー |
| [ドキュメント構成マップ](docs/STRUCTURE.md) | ファイル一覧と役割、更新の依存関係、Single Source of Truth の定義 |
| [開発プラン](docs/plan/README.md) | タスク一覧と進捗管理（dev ブランチのみ） |
| [API仕様](docs/design/api-contracts.md) | REST API の詳細仕様 |

### 要件定義

- [jupyter-server](docs/requirements/jupyter-server.md)
- [jupyter-mcp](docs/requirements/jupyter-mcp.md)
- [jupyterlab-ai-sync](docs/requirements/jupyterlab-ai-sync.md)
- [document-server](docs/requirements/document-server.md)
- [document-mcp](docs/requirements/document-mcp.md)
