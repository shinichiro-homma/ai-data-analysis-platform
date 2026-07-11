---
name: jupyter-kernel-communication
description: Jupyter ServerのREST API・WebSocketプロトコル・カーネルライフサイクルを扱う。jupyter-mcpのツール追加時に使用する。
---

# Jupyter カーネル通信パターン

Jupyter Server の REST API・WebSocket プロトコル・カーネルライフサイクルの実装パターン。jupyter-mcp のツール追加時に参照する。

## アーキテクチャ概要

```
┌─────────────┐     REST API      ┌────────────────┐    Jupyter Protocol    ┌────────┐
│ jupyter-mcp │ ──────────────→  │ jupyter-server  │ ←─────────────────→  │ Kernel │
│ (MCP Server)│ ←──────────────  │ (Custom Extensions)│                     │(IPython)│
└─────────────┘                  └────────────────┘                       └────────┘
                                        │
                                   WebSocket /api/ai/events
                                        │
                                        ▼
                                ┌──────────────────┐
                                │ jupyterlab-ai-sync│
                                │ (JupyterLab拡張)  │
                                └──────────────────┘
```

- **jupyter-mcp → jupyter-server**: カスタム REST API（Jupyter 標準 API をラップ）
- **jupyter-server → カーネル**: Jupyter Kernel Protocol（ZMQ、AsyncKernelClient）
- **jupyter-server → ブラウザ**: WebSocket `/api/ai/events`（AI 操作の同期）

## REST API エンドポイント

### カーネル管理

| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/api/kernels` | カーネル一覧 |
| POST | `/api/kernels` | カーネル起動 |
| GET | `/api/kernels/{id}` | カーネル情報 |
| DELETE | `/api/kernels/{id}` | カーネル停止 |
| POST | `/api/kernels/{id}/interrupt` | カーネル中断 |
| POST | `/api/kernels/{id}/restart` | カーネル再起動 |

### コード実行（カスタム拡張）

```
POST /api/kernels/{kernel_id}/execute
```

リクエスト:
```json
{"code": "print('hello')", "timeout": 30}
```

レスポンス:
```json
{
  "success": true,
  "execution_count": 1,
  "outputs": [...],
  "result": null,
  "images": [{"file_path": "...", "mime_type": "image/png", "description": "..."}],
  "execution_time_ms": 150,
  "error": null
}
```

### 変数管理（カスタム拡張）

| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/api/kernels/{id}/variables` | 変数一覧 |
| GET | `/api/kernels/{id}/variables/{name}` | 変数詳細（DataFrame: shape/columns/dtype/head） |

### セッション管理

| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/api/sessions` | セッション一覧（Jupyter 標準） |
| POST | `/api/sessions` | セッション作成（Jupyter 標準） |
| POST | `/api/custom/sessions` | ワークスペース対応セッション作成 |

### ワークスペース

| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/workspaces` | 作成 |
| GET | `/api/workspaces` | 一覧 |
| PUT | `/api/workspaces/{id}` | メタデータ更新 |
| POST | `/api/workspaces/{id}/summarize` | サマリテンプレート取得 |

### ファイル・ノートブック（カスタム拡張）

| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/api/custom/contents[?path=...]` | ファイル一覧 |
| GET | `/api/custom/contents/{path}` | ファイル取得 |
| POST | `/api/custom/contents` | ファイル作成 |
| PUT | `/api/custom/contents/{path}` | ファイル更新 |
| DELETE | `/api/custom/contents/{path}` | ファイル削除 |
| PATCH | `/api/custom/contents/{path}/cells` | セル操作（add/update/delete） |

### SQL 実行（カスタム拡張）

| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/sql/execute` | SQL 実行 + CSV 保存 |
| POST | `/api/sql/export` | SQL エクスポート（Parquet/CSV ストリーミング） |

### AI 同期イベント

| メソッド | パス | 用途 |
|---------|------|------|
| WS | `/api/ai/events?token={token}` | WebSocket（トークン認証） |
| POST | `/api/ai/events/broadcast` | イベントブロードキャスト |

## カーネルライフサイクル

```
POST /api/kernels (or POST /api/custom/sessions)
  ↓
[starting] → [idle] ←→ [busy] → [dead]
                │
                ↓ (KERNEL_TIMEOUT 秒、デフォルト 1800秒)
         自動停止（cull）
         条件: WebSocket 接続 0 かつ busy でない
```

### セッション作成フロー

```
POST /api/custom/sessions {workspace_id}
  ↓
1. ワークスペースディレクトリ解決
2. ノートブック作成（ワークスペース内）
3. カーネル起動（cwd = ワークスペースディレクトリ）
4. セッション作成（notebook ↔ kernel 紐付け）
5. Python スタートアップスクリプト注入（ファイルアクセス制限）
  ↓
session_id + kernel_id 返却
```

### アイドルカーネル自動停止（cull）

- `KERNEL_TIMEOUT` 環境変数で制御（デフォルト 1800秒 = 30分）
- 定期チェック間隔: `KERNEL_CULL_INTERVAL`（デフォルト 300秒）
- 停止条件: アイドル状態 + WebSocket 接続なし + busy でない
- カーネル停止時に画像カウンターとワークスペース情報をクリーンアップ

## メッセージプロトコル（IOPub チャネル）

### msg_id / parent_header の仕組み

```
クライアント → カーネル（shell チャネル）:
  {
    header: {msg_id: "abc-123", msg_type: "execute_request"},
    content: {code: "print('hello')"}
  }

カーネル → クライアント（IOPub チャネル）:
  {
    header: {msg_id: "xyz-456", msg_type: "stream"},
    parent_header: {msg_id: "abc-123"},  ← リクエストの msg_id
    content: {name: "stdout", text: "hello\n"}
  }
```

**重要:** `parent_header.msg_id` でリクエストと応答を対応付ける。

### メッセージシーケンス

```
execute_request (client → kernel)
  ↓
status: busy              ← 実行開始
  ↓
execute_input             ← execution_count 通知
  ↓
stream (stdout/stderr)    ← 出力（複数回）
  ↓
display_data              ← 画像・グラフ（複数回）
  ↓
execute_result            ← 式の評価結果
  ↓ (エラー時は error メッセージ)
status: idle              ← 実行完了
```

### JupyterLab UI との同期問題

**問題:** JupyterLab フロントエンドは `parent_header.msg_id` をチェックし、自身が発行した `msg_id` と一致するメッセージのみを UI に反映する。外部クライアント（jupyter-mcp）からの実行結果はノートブック UI に表示されない。

**解決:** `jupyterlab-ai-sync` 拡張が WebSocket `/api/ai/events` を購読し、AI 操作イベントを受信してノートブック UI を更新する。

## AI 同期イベント

### イベントフロー

```
jupyter-mcp
  ↓ POST /api/ai/events/broadcast
jupyter-server (AiEventsWebSocketHandler)
  ↓ WebSocket broadcast
jupyterlab-ai-sync (ブラウザ)
  ↓ ノートブック UI 更新
```

### イベントタイプ

| イベント | 発信元 | ペイロード | 用途 |
|---------|--------|-----------|------|
| `lock_acquired` | jupyter-server | `{notebook_path}` | ロック取得 → UI readOnly 表示 |
| `cell_added` | jupyter-mcp | `{notebook_path, cell: {cell_type, source}, index}` | セル追加 → UI 反映 |
| `cell_execute_start` | jupyter-mcp | `{notebook_path, cell_index}` | 実行開始 → セル実行中表示 |
| `cell_output` | jupyter-mcp | `{notebook_path, cell_index, output}` | 出力 → セルに追加（複数回） |
| `cell_execute_end` | jupyter-mcp | `{notebook_path, cell_index, execution_count, success}` | 実行完了 |
| `lock_released` | jupyter-server | `{notebook_path}` | ロック解放・TTL 失効 → readOnly 解除 |

### CellOutputData 構造

```typescript
type CellOutputData =
  | { output_type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { output_type: 'display_data'; data: Record<string, string>; metadata: Record<string, unknown> }
  | { output_type: 'execute_result'; execution_count: number; data: Record<string, string>; metadata: Record<string, unknown> }
  | { output_type: 'error'; ename: string; evalue: string; traceback: string[] };
```

## コード実行の実装パターン

jupyter-mcp の `execute_code` ツールが実装するフロー:

```
1. 入力検証
   ├─ session_id: 必須、最大200文字
   ├─ code: オプション、最大1,000,000文字
   ├─ timeout: 0-300秒
   └─ cell_index: -1 以上

2. セッション解決
   → SessionResolver で kernel_id と notebook_path を取得

3. セルインデックス特定
   ├─ cell_index 明示指定 → そのまま使用
   └─ 未指定 → resolveOrCreateCell で末尾セルを検索 / 不一致時は自動追加

4. イベント配信（fire-and-forget）
   ├─ cell_execute_start → WebSocket ブロードキャスト
   ├─ cell_output × N → 出力ごとにブロードキャスト
   └─ cell_execute_end → WebSocket ブロードキャスト

5. ブラウザ接続数に応じた永続化判断
   ├─ clients > 0 → WebSocket 配信済み → REST 書き込み不要
   └─ clients === 0 → ディスクに出力を永続化

6. MCP レスポンス生成
   ├─ stdout/stderr 結合
   ├─ 画像を ImageReference に変換
   └─ 標準形式で返却
```

## 画像管理

```python
# カーネルごとのグローバルカウンター（セッション横断で連番）
_kernel_image_counters: dict[str, int] = {}

# 保存パス
file_path = f"workspaces/{workspace_id}/output/exec-{execution_count}-img-{image_index:03d}.png"

# カーネル削除時にカウンターをクリーンアップ
```

## エラー体系

| エラークラス | HTTP | コード | 発生条件 |
|-------------|------|--------|---------|
| UnauthorizedError | 401 | UNAUTHORIZED | トークン無効 |
| KernelNotFoundError | 404 | KERNEL_NOT_FOUND | カーネル ID 不在 |
| KernelDeadError | 400 | KERNEL_DEAD | カーネル停止済み |
| NotebookNotFoundError | 404 | NOTEBOOK_NOT_FOUND | ノートブック不在 |
| ExecutionTimeoutError | 408 | EXECUTION_TIMEOUT | タイムアウト超過 |
| ConnectionError | 503 | CONNECTION_ERROR | サーバー接続失敗 |
| ValidationError | 400 | VALIDATION_ERROR | 入力パラメータ不正 |

エラーフロー: `Axios → AxiosError → JupyterClientError → MCP エラーレスポンス`

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `jupyter-server/extensions/custom_api/kernel_executor.py` | カーネル実行・メッセージ処理 |
| `jupyter-server/extensions/custom_api/ai_events.py` | WebSocket イベント配信 |
| `jupyter-mcp/src/jupyter-client/client.ts` | Jupyter Server REST クライアント |
| `jupyter-mcp/src/jupyter-client/types.ts` | 型定義 |
| `jupyter-mcp/src/jupyter-client/errors.ts` | エラークラス定義 |
| `jupyter-mcp/src/tools/execute-code.ts` | コード実行ツール |
| `jupyter-mcp/src/utils/session-resolver.ts` | セッション解決 |
| `jupyterlab-ai-sync/src/websocket-client.ts` | ブラウザ側 WebSocket クライアント |
| `jupyterlab-ai-sync/src/notebook-updater.ts` | ノートブック UI 更新 |
| `jupyterlab-ai-sync/src/lock-manager.ts` | 編集ロック管理 |
