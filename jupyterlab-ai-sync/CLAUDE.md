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

| イベント | 説明 |
|---------|------|
| `ai_edit_start` | ノートブックをロック（ミドルウェアが自動配信） |
| `cell_added` | セルをUIに追加 |
| `cell_edited` | セルの内容を更新 |
| `cell_deleted` | セルをUIから削除 |
| `cell_reordered` | セルの並び順を変更 |
| `cell_execute_start` | セルを実行中状態にする |
| `cell_output` | セルに出力を追加（ストリーミング） |
| `cell_execute_end` | セルの実行中状態を解除 |
| `ai_edit_end` | ノートブックのロックを解除（ミドルウェアが自動配信） |

ペイロードの詳細は `src/websocket-client.ts` のメッセージハンドリングを参照。

## 要件定義

詳細は [docs/requirements/jupyterlab-ai-sync.md](../docs/requirements/jupyterlab-ai-sync.md) を参照。

## 依存関係

- jupyter-server の AI同期WebSocketエンドポイント（`/api/ai/events`）が実装されていること
