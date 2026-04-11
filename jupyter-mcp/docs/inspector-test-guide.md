# MCP Inspector テスト手順書

## 概要

このドキュメントは、jupyter-mcp サーバーの全ツール・リソースを MCP Inspector で動作確認する手順を記録したものです。

## 前提条件

- jupyter-server が Docker で起動していること
- jupyter-mcp がビルド済みであること（`npm run build`）

## 環境準備

### 1. jupyter-server の起動確認

```bash
cd jupyter-server && docker-compose ps
```

起動していない場合は起動する：

```bash
docker-compose up -d
```

### 2. jupyter-mcp のビルド

```bash
cd jupyter-mcp && npm run build
```

### 3. MCP Inspector の起動

```bash
cd jupyter-mcp
npx @modelcontextprotocol/inspector \
  -e JUPYTER_SERVER_URL=http://localhost:8888 \
  -e JUPYTER_TOKEN="$(grep '^JUPYTER_TOKEN=' ../.env | cut -d= -f2-)" \
  node dist/index.js
```

`JUPYTER_TOKEN` はプロジェクト直下の `.env` と完全一致させる必要があります（ここではシェル展開で `.env` から読み込んでいます）。

起動後、以下のような出力が表示される：

```
🚀 MCP Inspector is up and running at:
   http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...
```

## ツール一覧の確認

### 期待される 11 ツール

1. `notebook_create` - ノートブック作成
2. `notebook_add_cell` - セル追加
3. `session_create` - セッション作成
4. `session_list` - セッション一覧取得
5. `session_delete` - セッション削除
6. `session_connect` - 既存セッションへの接続
7. `execute_code` - コード実行
8. `get_variables` - 変数一覧取得
9. `get_dataframe_info` - DataFrame 詳細情報取得
10. `file_list` - ファイル一覧取得
11. `get_image_resource` - 画像リソース取得

## 基本フローのテスト

### 1. セッション作成（session_create）

**入力:**
```json
{}
```

**期待される出力:**
```json
{
  "success": true,
  "session_id": "<uuid>",
  "kernel_id": "<uuid>",
  "status": "starting",
  "created_at": "<timestamp>"
}
```

**確認項目:**
- ✅ session_id と kernel_id が返される
- ✅ status が "starting" または "idle"

### 2. セッション一覧（session_list）

**入力:**
```json
{}
```

**期待される出力:**
```json
{
  "success": true,
  "sessions": [
    {
      "session_id": "<uuid>",
      "kernel_id": "<uuid>",
      "status": "idle",
      "created_at": "<timestamp>",
      "kernel_name": "python3"
    }
  ]
}
```

**確認項目:**
- ✅ 先ほど作成したセッションが一覧に含まれる

### 3. ノートブック作成（notebook_create）

**入力:**
```json
{
  "name": "inspector-test"
}
```

**期待される出力:**
```json
{
  "success": true,
  "path": "/inspector-test.ipynb",
  "created_at": "<timestamp>",
  "message": "ノートブック \"inspector-test.ipynb\" を作成しました"
}
```

**確認項目:**
- ✅ ノートブックが作成される
- ✅ path に `.ipynb` 拡張子が含まれる

### 4. コード実行（execute_code）

**入力:**
```json
{
  "session_id": "<step1のsession_id>",
  "code": "print('hello from inspector')"
}
```

**期待される出力:**
```json
{
  "success": true,
  "stdout": "hello from inspector\n",
  "stderr": "",
  "result": null,
  "images": [],
  "execution_time_ms": 140
}
```

**確認項目:**
- ✅ stdout に期待する出力が含まれる
- ✅ success が true

### 5. 変数定義

**入力:**
```json
{
  "session_id": "<session_id>",
  "code": "import pandas as pd\ndf = pd.DataFrame({'a': [1,2,3], 'b': [4,5,6]})\nx = 42"
}
```

**期待される出力:**
```json
{
  "success": true,
  "stdout": "",
  "stderr": "",
  "result": null,
  "images": [],
  "execution_time_ms": 463
}
```

### 6. 変数一覧取得（get_variables）

**入力:**
```json
{
  "session_id": "<session_id>"
}
```

**期待される出力:**
```json
{
  "success": true,
  "variables": [
    {
      "name": "df",
      "type": "DataFrame",
      "size": "3 rows × 2 cols",
      "memory_bytes": 180
    },
    {
      "name": "x",
      "type": "int",
      "value": 42
    }
  ]
}
```

**確認項目:**
- ✅ df と x が変数一覧に含まれる
- ✅ DataFrame のサイズ情報が正しい

### 7. DataFrame 詳細情報取得（get_dataframe_info）

**入力:**
```json
{
  "session_id": "<session_id>",
  "variable_name": "df"
}
```

**期待される出力:**
```json
{
  "success": true,
  "name": "df",
  "shape": [3, 2],
  "columns": ["a", "b"],
  "dtypes": {
    "a": "int64",
    "b": "int64"
  },
  "describe": {
    "a": {
      "count": 3,
      "mean": 2,
      "std": 1,
      "min": 1,
      "max": 3
    },
    "b": {
      "count": 3,
      "mean": 5,
      "std": 1,
      "min": 4,
      "max": 6
    }
  },
  "memory_bytes": 180,
  "head": [
    {"a": 1, "b": 4},
    {"a": 2, "b": 5},
    {"a": 3, "b": 6}
  ]
}
```

**確認項目:**
- ✅ shape が [3, 2]
- ✅ カラム情報が正しい
- ✅ 統計情報と先頭行データが取得できる

### 8. グラフ描画

**入力:**
```json
{
  "session_id": "<session_id>",
  "code": "import matplotlib.pyplot as plt\nplt.figure()\nplt.plot([1,2,3],[4,5,6])\nplt.title('Inspector Test')\nplt.show()"
}
```

**期待される出力:**
```json
{
  "success": true,
  "stdout": "",
  "stderr": "",
  "result": null,
  "images": [
    {
      "resource_uri": "jupyter://sessions/<session_id>/images/<image_id>.png",
      "mime_type": "image/png",
      "description": "matplotlib output [1]"
    }
  ],
  "execution_time_ms": 485
}
```

**確認項目:**
- ✅ images 配列に resource_uri が含まれる
- ✅ mime_type が "image/png"

### 9. 画像リソース取得（get_image_resource）

**入力:**
```json
{
  "resource_uri": "jupyter://sessions/<session_id>/images/<image_id>.png"
}
```

**期待される出力:**
```json
{
  "success": true,
  "mime_type": "image/png",
  "data": "iVBORw0KGgoAAAANSUhEUgAAAiwAAAGxCAYAAABBZ..."
}
```

**確認項目:**
- ✅ data に base64 エンコードされた画像データが含まれる
- ✅ mime_type が正しい

## リソースの確認

### Resources タブでの確認

1. Inspector の「Resources」タブをクリック
2. 「List Resources」ボタンをクリック
3. 画像リソースが表示されることを確認

**期待される表示:**
```
jupyter://sessions/<session_id>/images/<image_id>.png
matplotlib output [1]
```

**確認項目:**
- ✅ リソース URI が正しい形式
- ✅ 説明文が表示される

## エラーケースの確認

### 1. 存在しないセッション

**入力:**
```json
{
  "session_id": "nonexistent",
  "code": "print('test')"
}
```

**期待される動作:**
- エラーメッセージが返る
- サーバーがクラッシュしない

### 2. Python エラー

**入力:**
```json
{
  "session_id": "<valid_session_id>",
  "code": "1/0"
}
```

**期待される出力:**
```json
{
  "success": false,
  "error_type": "ZeroDivisionError",
  "error_message": "division by zero"
}
```

## テスト結果

### 実施日時

2026-02-06

### 確認済み項目

- ✅ MCP Inspector が起動し、jupyter-mcp に接続できる
- ✅ 全 11 ツールが Tools タブに表示される
- ✅ 各ツールの inputSchema が正しく表示される
- ✅ session_create / session_list が正常動作する
- ✅ notebook_create が正常動作する
- ✅ execute_code で Python コードが実行でき、結果が返る
- ✅ get_variables / get_dataframe_info が正常動作する
- ✅ execute_code でグラフ描画時に images 配列に resource_uri が返る
- ✅ get_image_resource で画像データ（base64）が取得できる
- ✅ Resources タブで画像リソースの一覧が表示される

### 備考

- すべての主要機能が正常に動作することを確認
- MCP プロトコル経由での疎通に問題なし
- 次のタスク 8.3（Claude Desktop 連携）に進める準備が整った
