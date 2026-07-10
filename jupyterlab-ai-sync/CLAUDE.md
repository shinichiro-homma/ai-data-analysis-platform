# jupyterlab-ai-sync

JupyterLabのフロントエンド拡張。AIの操作をノートブック上でリアルタイム表示する。

## 概要

- jupyter-serverのWebSocket `/api/ai/events` からAI操作イベントを受信
- ノートブックUIにセル追加・実行結果をリアルタイム反映
- AI編集中のノートブックロック/アンロック制御
- WebSocket切断時は全ノートブックのロックを自動解除し、自動再接続を試行

## 技術スタック

[docs/requirements/jupyterlab-ai-sync.md](../docs/requirements/jupyterlab-ai-sync.md) を参照。

## コマンド

ルートで `uv sync` を実行してから以下を行う（JupyterLab 等はルート venv 経由で解決される）:

```bash
# 依存関係インストール（初回のみ）
npm install

# ビルド（ルート venv の jupyter を使用）
uv run --project .. npm run build

# JupyterLabにインストール（開発モード）
uv run jupyter labextension develop . --overwrite
```

## 受信イベント

受信イベントの一覧・ペイロード型・ディスパッチは `src/notebook-updater.ts` が正（`handleEvent()` の `switch (event.type)` と各 `*Event` インターフェース定義）。基底の `AiEvent` 型と WebSocket 受信処理は `src/websocket-client.ts` を参照。機能要件との対応は [docs/requirements/jupyterlab-ai-sync.md](../docs/requirements/jupyterlab-ai-sync.md) を参照。

## 要件定義

詳細は [docs/requirements/jupyterlab-ai-sync.md](../docs/requirements/jupyterlab-ai-sync.md) を参照。

## 依存関係

- jupyter-server の AI同期WebSocketエンドポイント（`/api/ai/events`）が実装されていること
