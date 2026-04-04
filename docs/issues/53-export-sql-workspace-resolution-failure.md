# Issue #53: notebook_path なしの session_create 後に export_sql がワークスペース特定に失敗する

## 関連タスク

- タスク番号: Jupyter 14.2（export_sql ツール実装）、Jupyter 9.2（execute_sql ツール実装 — 同様の問題がある可能性）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`workspace_create` → `session_create`（notebook_path なし）→ `export_sql` の順に実行すると、初回で必ず以下のエラーが発生する：

> セッションからワークスペースIDを特定できません。session_create で workspace_id を指定してセッションを作成してください。

## 再現手順

1. `workspace_create` でワークスペースを作成する
2. `session_create` で `workspace_id` のみ指定し、`notebook_path` を省略してセッションを作成する
3. `export_sql` を実行する → エラー

## 再現確認結果

- 再現: できた
- 確認方法: curl で REST API を直接呼び出し + 標準 Jupyter sessions API (`GET /api/sessions`) の確認
- エビデンス:
  - `notebook_path` なしで作成したセッションは標準 Jupyter sessions API に登録されない
  - MCP 側 `sessionNotebookStore` にも何も保存されない（`session.notebook_path` が存在しないため）
  - `resolveSession()` が `notebookPath: null` を返す
  - サーバー側には `_kernel_workspace_map`（`kernel_id → workspace_id`）が存在するが、MCP 側から参照する API がない

## 期待する動作

`notebook_path` を省略した `session_create` でも、`export_sql` がワークスペースを正しく特定できること。

## 原因

### 根本原因

MCP 側に `session_id/kernel_id → workspace_id` のマッピングを保持する仕組みがない。

`session_create` は `workspace_id` を引数として受け取り、レスポンスにも含めて返すが、`notebook_path` が省略された場合、`sessionNotebookStore` への保存がスキップされる（`jupyter-mcp/src/tools/session-create.ts:46-49`）。その結果、後続の `export_sql` / `execute_sql` がセッションからワークスペースを特定できない。

### 処理フローの詳細

1. `session_create`（notebook_path なし）
   - `sessionNotebookStore` への保存が `if (session.notebook_path)` でスキップされる（`session-create.ts:46`）
2. `export_sql` → `resolveSession()` を呼ぶ
   - Jupyter sessions API から検索 → notebook_path なしのセッションは `path` が空 → `null`（`session-resolver.ts:26-44`）
   - `sessionNotebookStore` フォールバック → 何も保存されていないため `null`（`session-resolver.ts:47-49`）
3. `notebookPath = null` → `extractWorkspaceIdFromPath(null)` はスキップ → `workspaceId = null` → エラー（`export-sql.ts:88-93`）

### 補足

- jupyter-server 側には `_kernel_workspace_map`（kernel_id → workspace_id）が存在する（`session_handlers.py:30`）
- しかし MCP 側からこのマップを参照する API エンドポイントが存在しない
- `execute_sql` にも同様の問題がある可能性（Issue 本文に記載済み）

## 修正方針

### アプローチ: MCP 側に sessionWorkspaceStore を追加

`sessionNotebookStore` と同様のインメモリストアとして `sessionWorkspaceStore`（session_id/kernel_id → workspace_id）を新設し、`session_create` で常に保存する。`export_sql` / `execute_sql` のワークスペース特定ロジックで、`notebookPath` からの特定に失敗した場合のフォールバックとしてこのストアを参照する。

**この方針を選択する理由:**
- jupyter-server 側の API 追加が不要（変更が MCP 側で完結する）
- `session_create` は既に `workspace_id` を保持しているため、追加の API 呼び出しも不要
- 既存の `sessionNotebookStore` パターンに沿った設計で一貫性がある

### 影響範囲

- **jupyter-mcp のみ** — jupyter-server や他コンポーネントの変更は不要
- 要件定義の変更: 不要（仕様上「セッションIDからワークスペースを特定」は既に要求されており、実装の内部改善）
- API 仕様の変更: 不要

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/src/utils/session-workspace-store.ts` | **新規作成**: `sessionWorkspaceStore`（session_id/kernel_id → workspace_id のインメモリストア） |
| `jupyter-mcp/src/tools/session-create.ts` | `session_create` で `sessionWorkspaceStore.set(session_id, workspace_id)` / `set(kernel_id, workspace_id)` を常に呼ぶ |
| `jupyter-mcp/src/tools/export-sql.ts` | `notebookPath` から workspace_id を取得できない場合、`sessionWorkspaceStore` からフォールバック取得 |
| `jupyter-mcp/src/tools/execute-sql.ts` | 同上（`export_sql` と同様のフォールバック追加） |
| `jupyter-mcp/tests/unit/utils/session-workspace-store.test.ts` | **新規作成**: ストアのユニットテスト |
| `jupyter-mcp/tests/unit/tools/session-create.test.ts` | notebook_path なしでも workspace_id がストアに保存されることのテスト追加 |
| `jupyter-mcp/tests/unit/tools/export-sql.test.ts` | notebookPath null + sessionWorkspaceStore フォールバックのテスト追加 |
| `jupyter-mcp/tests/unit/tools/execute-sql.test.ts` | 同上 |

### テスト計画

1. **ユニットテスト**
   - `sessionWorkspaceStore` の CRUD テスト
   - `session_create`: notebook_path なしでも workspace_id がストアに保存される
   - `export_sql` / `execute_sql`: notebookPath が null でも sessionWorkspaceStore から workspace_id を取得できる
2. **統合テスト**（既存テストの実行で回帰確認）
   - `scripts/test.sh --rebuild jupyter-mcp`
   - `scripts/test.sh --integration --rebuild jupyter-mcp`
3. **手動確認**
   - `workspace_create` → `session_create`（notebook_path なし）→ `export_sql` の再現手順でエラーが解消されること
