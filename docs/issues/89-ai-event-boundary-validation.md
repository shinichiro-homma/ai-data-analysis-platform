# Issue #89: AI イベント境界の入力検証欠落（サーバー無検証転送・フロント無検証キャスト）

## 関連タスク

- タスク番号: 21.3

## ステータス

- [x] 起票
- [ ] 原因特定
- [ ] 修正方針レビュー完了
- [ ] 修正完了

## 症状

AI イベントの境界で入力検証が両端とも欠落している（21.2/21.3 レトロスペクティブ監査の指摘 3）。

- サーバー側: `POST /api/ai/events`（`jupyter-server/extensions/custom_api/ai_events.py:116-126`）は `@web.authenticated` 以外の検証がなく、任意構造の JSON をそのまま全 WebSocket クライアントへブロードキャストする（type の allowlist 照合・必須フィールドの型検証なし）
- フロント側: `jupyterlab-ai-sync/src/notebook-updater.ts:69-92` の `handleEvent` は受信イベントを無検証キャストし、try/catch もない。`notebook_path` が欠落・型不一致のイベント（例: `{"type":"notebook_changed"}`）を受けると `normalizeNotebookPath(undefined)` が `TypeError` を投げ、`websocket-client.ts:61-70` の onmessage（JSON パースエラーのみ catch）まで伝播して当該イベント処理が中断する

## 再現手順

1. 認証トークン付きで `curl -X POST http://localhost:8888/api/ai/events -d '{"type":"notebook_changed"}'`（`notebook_path` 欠落）を送信
2. ノートブックを開いているブラウザのコンソールに `TypeError`（`undefined.startsWith`）が出力され、イベント処理が中断する

## 再現確認結果

- 再現: 静的検証のみ（実行再現は未実施）
- 確認方法: 監査でのコード裏取り。`ai_events.py:116-126`（検証なしの `json.loads` → `broadcast_event`）、`notebook-updater.ts:101-102`（無検証キャスト → `findNotebookByPath`）、`path-utils.ts` の `startsWith` 呼び出しの経路を確認済み

## 期待する動作

- サーバー: `AiEventsPostHandler.post` が type を既知 5 種（`notebook_changed` / `cell_execute_start` / `cell_execute_end` / `lock_acquired` / `lock_released`）の allowlist と照合し、`notebook_changed` は `notebook_path: str` / `seq: int` を必須検証して不正なら 400 を返す
- フロント: `handleNotebookChanged` 等のハンドラ冒頭で `notebook_path` の型を検証し、不正なら warn して return する（または `handleEvent` の switch 全体を try/catch で保護）

## 原因（調査後に記入）

（根本原因）

## 修正方針（調査後に記入）

### 影響範囲

（修正が影響するファイル・コンポーネント）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `path/to/file` | （変更内容） |

### テスト計画

（どのようにテストするか）
