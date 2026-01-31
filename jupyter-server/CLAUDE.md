# jupyter-server

JupyterLabベースのデータ分析実行環境。

## 概要

- Pythonカーネルでコードを実行
- jupyter-mcp からREST API経由で操作される
- Dockerコンテナとしてデプロイ

## 技術スタック

- JupyterLab
- Python 3.11+
- pandas, numpy, matplotlib, seaborn, plotly

## ディレクトリ構成

```
jupyter-server/
├── CLAUDE.md
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── jupyter_config/
│   └── jupyter_server_config.py
└── scripts/
    └── healthcheck.sh
```

## コマンド

```bash
# ビルド
docker build -t jupyter-server .

# 起動
docker-compose up -d

# ログ確認
docker-compose logs -f

# 停止
docker-compose down
```

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `JUPYTER_TOKEN` | 認証トークン | （必須） |
| `KERNEL_TIMEOUT` | アイドルタイムアウト（秒） | 1800 |
| `EXECUTION_TIMEOUT` | 実行タイムアウト（秒） | 30 |

## ポート

- 8888: JupyterLab UI / REST API

## 要件定義

詳細は [docs/requirements/jupyter-server.md](../docs/requirements/jupyter-server.md) を参照。

## 依存関係

- なし（最初に開発するコンポーネント）
