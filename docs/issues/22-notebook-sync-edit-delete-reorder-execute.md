# Issue #22: notebook_edit/delete/execute/reorder がブラウザにリアルタイム反映されない

## 関連タスク

- タスク番号: 16.1, 16.2, 17.1

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`notebook_edit_cell`、`notebook_delete_cell`、`notebook_execute_cell`、`notebook_reorder_cell` の4つのMCPツールで操作した結果が、ブラウザ上のJupyterLab UIにリアルタイムで反映されない。

ディスク上のノートブックファイルは正しく更新されるが、ブラウザをリロードしない限りUIに変化が現れない。

## 再現手順

1. JupyterLab でノートブックを開く
2. `notebook_add_cell` でセルを追加する → ブラウザに即座に反映される（正常）
3. `notebook_edit_cell` でセル内容を変更する → ブラウザに反映されない（バグ）
4. `notebook_delete_cell` でセルを削除する → ブラウザに反映されない（バグ）
5. `notebook_reorder_cell` でセルを並び替える → ブラウザに反映されない（バグ）
6. `notebook_execute_cell` でセルを実行する → 実行状態・出力がブラウザに反映されない（バグ）

## 再現確認結果

- 再現: できた
- 確認方法: Playwright MCP でブラウザを操作 + curl で REST API を直接呼び出し
- エビデンス: `docs/issues/evidence-notebook-sync-not-reflected.png`
  - セル0を `print("EDITED by MCP!")` に REST API で更新したが、ブラウザには元の `print("Hello from MCP!")` が表示されたまま

## 期待する動作

4つのMCPツール（edit, delete, execute_cell, reorder）で操作した結果が、`notebook_add_cell` や `execute_code` と同様にブラウザ上でリアルタイムに反映されること。

## 原因

### 根本原因

2箇所の実装漏れにより、4ツールの操作がブラウザに反映されない。

### 原因1: jupyter-mcp — イベント未配信

`notebook_add_cell` は `cell-operations.ts:34-42` の `addCellWithSync` 内で `jupyterClient.postAiEvent({ type: 'cell_added', ... })` を呼び、`POST /api/ai/events/broadcast` 経由でブラウザに配信している。

しかし、以下の4ツールは REST API でディスクに書き込むだけで、`postAiEvent` を一切呼んでいない:

| ツール | ファイル | 処理 | `postAiEvent` |
|--------|---------|------|---------------|
| `notebook_edit_cell` | `src/tools/notebook-edit-cell.ts:59-65` | `operateCell({action: 'update'})` | なし |
| `notebook_delete_cell` | `src/tools/notebook-delete-cell.ts:48-51` | `operateCell({action: 'delete'})` | なし |
| `notebook_execute_cell` | `src/tools/notebook-execute-cell.ts:73-76` | `executeCellInNotebook()` | なし |
| `notebook_reorder_cell` | `src/tools/notebook-reorder-cell.ts:55-59` | `operateCell({action: 'reorder'})` | なし |

### 原因2: jupyterlab-ai-sync — イベントハンドラ未実装

`notebook-updater.ts:72-95` の `handleEvent()` switch 文に以下のイベント型の case が存在しない:

- `cell_edited` — 未実装（`default` で無視）
- `cell_deleted` — 未実装（`default` で無視）
- `cell_reordered` — 未実装（`default` で無視）

※ `cell_execute_start` / `cell_output` / `cell_execute_end` のハンドラは既に実装済み（行 77-85）。`notebook_execute_cell` は jupyter-mcp 側でイベント配信を追加すれば、既存ハンドラで動作する。

### 補足: handleToolCall ミドルウェア

`index.ts:616-647` のミドルウェアは `ai_edit_start` / `ai_edit_end` のみ配信。操作内容を伝えるイベントは各ツールの責務だが、4ツールでは未実装。

## 修正方針

`notebook_add_cell` の実装パターン（REST API 書き込み後に `postAiEvent` でイベント配信）に倣い、4ツールにイベント配信を追加する。jupyterlab-ai-sync 側には新規イベント型のハンドラを追加する。

### 影響範囲

- **jupyter-mcp**: 4ツールのソースコード + ユニットテスト + 統合テスト
- **jupyterlab-ai-sync**: `notebook-updater.ts` にハンドラ追加（テストは現在存在しない）
- **docs/design/api-contracts.md**: `cell_edited` / `cell_deleted` / `cell_reordered` イベント型の定義追加（要件変更ワークフロー対象）
- **docs/requirements/jupyter-mcp.md**: 変更不要（F6.3 で既に「同様にリアルタイム配信する」と明記済み）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/src/tools/notebook-edit-cell.ts` | REST API 呼び出し後に `postAiEvent({ type: 'cell_edited', ... })` を追加 |
| `jupyter-mcp/src/tools/notebook-delete-cell.ts` | REST API 呼び出し後に `postAiEvent({ type: 'cell_deleted', ... })` を追加 |
| `jupyter-mcp/src/tools/notebook-execute-cell.ts` | カーネル実行フローで `cell_execute_start` / `cell_output` / `cell_execute_end` イベントを配信 |
| `jupyter-mcp/src/tools/notebook-reorder-cell.ts` | REST API 呼び出し後に `postAiEvent({ type: 'cell_reordered', ... })` を追加 |
| `jupyterlab-ai-sync/src/notebook-updater.ts` | `handleCellEdited` / `handleCellDeleted` / `handleCellReordered` ハンドラを追加 |
| `jupyter-mcp/tests/unit/tools/notebook-edit-cell.test.ts` | `postAiEvent` 呼び出しの検証を追加 |
| `jupyter-mcp/tests/unit/tools/notebook-delete-cell.test.ts` | `postAiEvent` 呼び出しの検証を追加 |
| `jupyter-mcp/tests/unit/tools/notebook-execute-cell.test.ts` | イベント配信の検証を追加 |
| `jupyter-mcp/tests/unit/tools/notebook-reorder-cell.test.ts` | `postAiEvent` 呼び出しの検証を追加 |
| `jupyter-mcp/tests/integration/ai-sync-flow.test.ts` | 4ツールのイベント配信統合テストを追加 |
| `docs/design/api-contracts.md` | `cell_edited` / `cell_deleted` / `cell_reordered` イベント型を定義 |

### テスト計画

1. **ユニットテスト**: 各ツールが `postAiEvent` を正しいイベント型・パラメータで呼ぶことを検証
2. **統合テスト**: `ai-sync-flow.test.ts` に4ツールのイベント配信フローを追加
3. **回帰テスト**: 既存の `notebook_add_cell` / `execute_code` のテストが引き続きパスすることを確認
