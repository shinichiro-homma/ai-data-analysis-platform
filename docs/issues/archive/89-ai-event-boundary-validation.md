# Issue #89: AI イベント境界の入力検証欠落（サーバー無検証転送・フロント無検証キャスト）

## 関連タスク

- タスク番号: 21.3

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

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

## 原因

AI イベント境界の両端で入力検証が実装されておらず、防御層が 1 つも存在しない。

### サーバー側（jupyter-server）

- `jupyter-server/extensions/custom_api/ai_events.py:87-136` の `AiEventsPostHandler.post` は `json.loads` 後に `type` の allowlist 照合・必須フィールド検証を一切行わず `broadcast_event(event)` に渡す。400 を返すのは `json.JSONDecodeError` のみ（128-131 行）
- イベント type を集中管理する定数・enum が jupyter-server 内に存在せず、`sync_state.py:41`（notebook_changed）、`lock_handlers.py:95, 114`（lock_acquired / lock_released）に文字列リテラルとして分散。照合すべき allowlist の SSoT がコード上にない
- `AiEventsPostHandler` は `JupyterHandler` 直継承で、`custom_api/base.py:111` の `BaseCustomHandler`（`write_error_response` による統一 400 パターン）を継承しておらず、パッケージ内の他ハンドラの慣習から外れている
- `notebook_changed` の `seq` は本来 `sync_state.py:36-45` の `notify_notebook_changed`（内部呼び出し経路）で生成されるものであり、REST 経路から届く `notebook_changed` を検証する仕組みがない

### フロント側（jupyterlab-ai-sync）

- `jupyterlab-ai-sync/src/notebook-updater.ts:69-92` の `handleEvent` が受信イベントを `as NotebookChangedEvent` 等で無検証キャスト。`AiEvent` 型（`websocket-client.ts:10-13`）は `{ type: string; [key: string]: unknown }` の緩い型で、実行時 type guard が存在しない
- `notebook_path` が欠落したイベントは `handleNotebookChanged`（101-106 行）→ `findNotebookByPath`（`notebook-finder.ts:14`）→ `normalizeNotebookPath`（`path-utils.ts:8-10`）と素通りし、`path.startsWith('/')` で `TypeError` が発生する
- 全 5 ハンドラが同じパターンを持つ。`handleCellExecuteStart` / `handleCellExecuteEnd` / lock 系の既存 try/catch はいずれも `notebook_path` を使う呼び出し（`getNotebookAndModel`、`lockNotebook` 内の `normalizeNotebookPath`）より**後ろ**にあり保護できない
- 例外は `websocket-client.ts:61-70` の onmessage の catch（本来 JSON パースエラー用）に握りつぶされ、当該イベント処理が中断する

### 仕様側の状況

- `docs/requirements/jupyter-server.md`（F4.2 / F4.3 / AC5）と `docs/requirements/jupyterlab-ai-sync.md`（F1.2 / F4）はイベント 5 種の列挙のみで、入力検証・不正イベント時の振る舞いは未規定
- `docs/design/api-contracts.md` は「詳細はコードが正」の方針であり、バリデーション詳細の追記は不要（プロジェクトのドキュメント方針とも一致）

## 修正方針

サーバー・フロントの両端に検証を追加する（多層防御）。

### サーバー側

1. `ai_events.py` に allowlist 定数 `ALLOWED_EVENT_TYPES`（既知 5 種）を新設し、イベント type の SSoT とする
2. `AiEventsPostHandler` を `BaseCustomHandler` 継承に変更し、`custom_api` の統一エラーパターン（`write_error_response("VALIDATION_ERROR", msg, 400)`）に揃える
   - 代替案: `JupyterHandler` 継承のまま独自に 400 を返す方法もあるが、パッケージ内の慣習（`lock_handlers.py` / `handlers.py:1361-1368` の allowlist 照合パターン）との統一性から継承変更を採る
3. `post` 内で `json.loads` 後に検証を追加:
   - `type` が str かつ allowlist に含まれること。不正なら 400
   - `type == "notebook_changed"` の場合、`notebook_path` が str・`seq` が int（bool を除外）であること。不正なら 400

### フロント側

1. `notebook-updater.ts` の `handleEvent` 冒頭に実行時検証（type guard）を追加: 全 5 イベント種が `notebook_path` を必要とするため、`typeof event.notebook_path !== 'string'` なら既存慣習に沿って `console.warn('[NotebookUpdater] ...')` を出力し早期 return する
2. 防御層として `handleEvent` の switch 全体を try/catch で囲み、1 イベントの処理失敗が例外として `websocket-client.ts` の onmessage（JSON パースエラー用 catch）へ漏れないようにする

### 影響範囲

- **jupyter-server**: `ai_events.py` のみ（継承変更 + 検証追加）。内部呼び出し経路（`sync_state.py` → `broadcast_event` 直呼び）は `post` を経由しないため影響なし。正規クライアント（jupyter-mcp からの broadcast POST）は正しい構造を送っている前提のため挙動不変
- **jupyterlab-ai-sync**: `notebook-updater.ts` のみ。正常イベントの処理フローは不変
- **要件定義・API 仕様**: 変更不要（バリデーション詳細は「コードが正」の方針。イベント 5 種は既に F4.2 / F1.2 / api-contracts.md に列挙済みで、allowlist はそれと一致させる）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-server/extensions/custom_api/ai_events.py` | `ALLOWED_EVENT_TYPES` 定数追加、`AiEventsPostHandler` を `BaseCustomHandler` 継承に変更、`post` に type allowlist 照合と `notebook_changed` の必須フィールド検証（不正時 400）を追加 |
| `jupyterlab-ai-sync/src/notebook-updater.ts` | `handleEvent` 冒頭に `notebook_path` の実行時型検証（不正時 warn + return）を追加し、switch 全体を try/catch で保護 |
| `jupyter-server/tests/test_ai_events.py`（新規） | POST バリデーションのテストを追加 |

### テスト計画

- **サーバー（pytest、必須）**: `jupyter-server/tests/test_ai_events.py` を新規作成し、以下を検証
  - allowlist 外の type / type 欠落 / type が非文字列 → 400
  - `notebook_changed` で `notebook_path` 欠落・非文字列 / `seq` 欠落・非 int（bool 含む） → 400
  - 正常な 5 種のイベント → 200 でブロードキャスト
  - 既存の `test_sync_state.py`（認証デコレータ検査・seq ストア）への回帰がないことを `scripts/test.sh jupyter-server` で確認
- **フロント（型チェックのみ）**: jupyterlab-ai-sync にはテスト基盤が存在しない（`scripts/test.sh` の対象外、test script なし）ため、`scripts/lint.sh` / ビルドによる型チェックで確認する。テスト基盤の導入は本 Issue のスコープ外
- **回帰テスト**: 統合テスト（`scripts/test.sh --integration`）で正規経路（jupyter-mcp → broadcast → WebSocket 配信）が影響を受けていないことを確認
