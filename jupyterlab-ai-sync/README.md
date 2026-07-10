# jupyterlab-ai-sync

AIの操作をノートブック上でリアルタイム表示するJupyterLab拡張機能。

## 機能

- **セル追加のリアルタイム反映** - AIが `notebook_add_cell` を呼ぶと、ブラウザ上のノートブックにセルが即座に追加される
- **実行結果のリアルタイム表示** - AIが `execute_code` を呼ぶと、stdout・画像・エラーがブラウザ上にストリーミング表示される
- **AI編集ロック制御** - AI編集中はノートブックを読み取り専用にし、完了後に自動解除

## 必要条件

- JupyterLab >= 4.0.0

## インストール

### Docker 経由（推奨）

`docker compose up -d` で jupyter-server を起動すると、本拡張は自動的にインストールされます。追加の設定は不要です。

### 手動インストール

ルートで `uv sync` 済みであれば、依存関係（JupyterLab 等）は解決済みです。

```bash
uv run jupyter labextension develop . --overwrite
```

## 開発

ルートで `uv sync` を実行してから以下を行う:

```bash
# 依存関係のインストール（初回のみ）
npm install

# ビルド（ルート venv の jupyter を使用）
uv run --project .. npm run build

# ウォッチモード（ファイル変更を検知して自動リビルド）
uv run --project .. npm run watch
```

別のターミナルで JupyterLab を起動:

```bash
uv run jupyter lab --watch
```

## 仕組み

jupyter-server の WebSocket エンドポイント `/api/ai/events` から AI 操作イベントを受信し、ノートブック UI に反映します。

```
jupyter-mcp → REST API → jupyter-server → WebSocket /api/ai/events → jupyterlab-ai-sync → ノートブックUI更新
```
