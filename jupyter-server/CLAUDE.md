# jupyter-server

JupyterLabベースのデータ分析実行環境。

## 概要

- Pythonカーネルでコードを実行
- jupyter-mcp からREST API経由で操作される
- AI操作イベントをWebSocketで配信
- Dockerコンテナとしてデプロイ
- シェルコマンド実行の多層防御: AST 検査（主防御）+ sandbox + IPython マジック無効化 + Terminals API 無効化
- SQL 実行は PostgreSQL read-only ロールで書き込み操作を DB レベルで拒否

## 技術スタック

[docs/requirements/jupyter-server.md](../docs/requirements/jupyter-server.md) を参照。

追加ライブラリの詳細は `jupyter-server/requirements.txt` を参照。
- `japanize-matplotlib` は kernel spec `exec_lines` で自動インポートされるため、明示的な `import` は不要

## コマンド

```bash
# 起動（プロジェクトルートから）
docker-compose up -d jupyter-server

# ログ確認
docker-compose logs -f jupyter-server

# 停止
docker-compose down
```

## 環境変数

| 変数 | 説明 |
|------|------|
| `DATA_ENV` | データ環境（sample / production） |
| `JUPYTER_TOKEN` | 認証トークン |
| `KERNEL_TIMEOUT` | アイドルタイムアウト（秒） |
| `EXECUTION_TIMEOUT` | 実行タイムアウト（秒） |
| `MAX_OUTPUT_SIZE` | 最大出力サイズ（バイト） |
| `WORKSPACE_ROOT_DIR` | ワークスペースルートディレクトリ |
| `DATABASE_URL` | PostgreSQL接続URL |

> デフォルト値・実装状況は `docker-compose.yml` および `extensions/custom_api/` のコードを参照。

## API一覧

`/health`, `/api/kernels`, `/api/kernels/{id}`, `/api/kernels/{id}/execute`, `/api/kernels/{id}/interrupt`, `/api/kernels/{id}/restart`, `/api/kernels/{id}/variables`, `/api/kernels/{id}/variables/{name}`, `/api/custom/contents`, `/api/custom/contents/{path}`, `/api/custom/contents/{path}/cells`, `/api/workspaces`, `/api/workspaces/{workspace_id}`, `/api/workspaces/{workspace_id}/summarize`, `/api/custom/sessions`, `/api/sql/execute`, `/api/sql/export`, `WS /api/ai/events`, `/api/ai/events/broadcast`

> 各エンドポイントの詳細は [docs/design/api-contracts.md](../docs/design/api-contracts.md) を参照。

## ポート

- 8888: JupyterLab UI / REST API / WebSocket

## 要件定義

詳細は [docs/requirements/jupyter-server.md](../docs/requirements/jupyter-server.md) を参照。

## 依存関係

- なし（最初に開発するコンポーネント）
