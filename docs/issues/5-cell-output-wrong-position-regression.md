# Issue #5: セル実行結果が正しいセルに出力されない（Cell 0集中・位置ずれの回帰）

## 関連タスク

- タスク番号: Jupyter 8.2（セル実行のリアルタイム同期）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

MCP経由でセルを実行した際、出力が正しいセルではなく先頭セル（Cell 0）や別のセルに表示される。また、出力内容が重複して表示される。

具体的な症状：
1. PermissionError 発生時、エラーが先頭セル（Cell 0）に出力された
2. エラー修正後にグラフが描画されたが、それも先頭セルに出力された
3. 各セルの出力が2回ずつ表示されている（出力の二重化）
4. `cell_added at index 19` だが `output added to cell 18` となり、ディスクとSharedModelのインデックスが不一致

過去の Issue #4（コミット `6a373c2`）で修正済みの内容の回帰。

## 再現手順

1. `docker-compose up -d` でサービスを起動
2. ブラウザで `http://localhost:8888/lab/tree/workspaces/ws-23999760/sales_loyalty_analysis.ipynb` を開く
3. MCP の `session_connect` でセッションに接続
4. MCP の `execute_code` を `cell_index` 未指定で実行（`resolveOrCreateCell` パスが使われる）
5. 出力が正しいセルではなく、別のセルに表示される

## 再現確認結果

- 再現: できた
- 確認方法: Playwright MCP + MCP execute_code
- エビデンス:
  - `docs/issues/evidence-cell-output-wrong-position.png` - Cell 0 に他セルの出力が集中
  - コンソールログ: `cell_added at index 19` / `output added to cell 18`（インデックスずれ）
  - コンソールエラー: `Code cell not found at index 5`（Markdownセルへの誤った参照）

## 期待する動作

- `execute_code` の出力は、実行対象のセルに正しく表示される
- 先頭セルに出力が集中しない
- 出力が二重化しない
- ディスク上のインデックスとSharedModel上のインデックスが一致する

## 原因

### 根本原因 1: `resolveOrCreateCell` がディスクのみを参照（症状 1・2・4）

**ファイル:** `jupyter-mcp/src/tools/execute-code.ts:250-270`

`execute_code` で `cell_index` が未指定の場合に呼ばれる `resolveOrCreateCell` は、`getContentsWithTimeout` でディスクからノートブックを直接読み込む。一方、`notebook_add_cell` は `notebook-cell-tracker` の `getEffectiveCellCount`/`setCellCount` でインメモリのセル数を管理している。

問題のシーケンス:
1. `notebook_add_cell` がセル追加 → SharedModel 経由で UI に反映、`setCellCount` でメモリ更新
2. 直後に `execute_code`（`cell_index` 未指定）が呼ばれる
3. `resolveOrCreateCell` がディスクを読む → 追加されたセルがまだディスク未反映
4. `cells.length` が実際より少ない → コード一致検索が失敗
5. `addCellToNotebook` が重複セルを追加し、ディスクベースの `currentCellCount` を返す
6. 誤ったインデックスが `cell_output` イベントに使われ、出力が別のセルに表示される

さらに、`addCellToNotebook`（行 278-307）はセル追加後に `setCellCount` を呼ばないため、セルトラッカーが更新されない。

### 根本原因 2: 出力管理の API 層混在（症状 3）

**ファイル:** `jupyterlab-ai-sync/src/notebook-updater.ts:142-215`

- `handleCellExecuteStart`（行 158）: SharedModel API で出力クリア → `sharedCodeCell.setOutputs([])`
- `handleCellOutput`（行 209）: OutputAreaModel API で出力追加 → `outputArea.model.add(output)`

JupyterLab 4.x では SharedModel と OutputAreaModel は双方向同期している。異なる API 層を使うと:
1. `setOutputs([])` → SharedModel 変更 → OutputAreaModel に伝播してクリア
2. `outputArea.model.add(output)` → OutputAreaModel 変更 → SharedModel に伝播して追加
3. SharedModel の変更が OutputAreaModel のリスナーに再度伝播 → 出力が二重に追加される可能性

通常の JupyterLab 実行パスは `msg_id` マッチングで循環を防いでいるが、外部からの操作にはこのガードが適用されない。

### 根本原因 3: JupyterLab のデフォルト空セルによるインデックスずれ（症状 1・2）

**ファイル:** `jupyterlab-ai-sync/src/notebook-updater.ts:100-137`

JupyterLab は空のノートブックを開くとデフォルトで空のコードセルを1つ追加する（SharedModel にのみ存在し、ディスクには書かれない）。MCP サーバーはディスクベースでセルを管理するため、MCP の `cell_index: 0` がブラウザの `cell_index: 1`（デフォルト空セルの後）に対応してしまい、全ての出力がデフォルト空セル（Cell 0）に集中する。

## 修正方針（調査後に記入）

### 方針 A: jupyter-mcp 側 — `resolveOrCreateCell` でセルトラッカーを使用

1. `execute-code.ts` に `getEffectiveCellCount` と `setCellCount` をインポート
2. `resolveOrCreateCell` でセル追加時に `getEffectiveCellCount` を使用してインデックスを計算
3. `addCellToNotebook` でセル追加後に `setCellCount` を呼んでトラッカーを更新

### 方針 B: jupyterlab-ai-sync 側 — OutputAreaModel API に統一

1. `handleCellExecuteStart` で `sharedCodeCell.setOutputs([])` を `codeCellWidget.outputArea.model.clear()` に変更
2. `handleCellOutput` は `outputArea.model.add()` のまま維持
3. 出力管理を OutputAreaModel API に統一し、双方向同期の循環を回避

### 影響範囲

- **jupyter-mcp**: `execute-code.ts` のセルインデックス解決ロジックのみ。他のツールへの影響なし。
- **jupyterlab-ai-sync**: `notebook-updater.ts` の出力管理のみ。セル追加・ロック制御への影響なし。
- 要件定義・API 仕様の変更は不要（実装バグの修正であり、仕様変更ではない）。

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/src/utils/notebook-cell-tracker.ts` | `addPendingCell`/`findPendingCell` を追加。`notebook_add_cell` で追加されたがディスク未反映のセルを追跡し、重複作成を防止。 |
| `jupyter-mcp/src/tools/notebook-add-cell.ts` | セル追加後に `addPendingCell` を呼んでペンディングセルを登録。 |
| `jupyter-mcp/src/tools/execute-code.ts` | `resolveOrCreateCell` でペンディングセルを先にチェック（重複防止）。`getEffectiveCellCount` を使用。`addCellToNotebook` で `setCellCount` を呼ぶ。 |
| `jupyterlab-ai-sync/src/notebook-updater.ts` | `handleCellExecuteStart` の出力クリアを `outputArea.model.clear()` に変更（OutputAreaModel API に統一）。`handleCellAdded` でデフォルト空セルを検出して置換（インデックスずれ防止）。 |
| `jupyter-mcp/tests/unit/tools/execute-code.test.ts` | `beforeEach` に `resetCellTracker()` を追加（テスト間のセルトラッカー状態リセット）。 |

### テスト計画

1. **ユニットテスト（jupyter-mcp）**
   - `execute-code.test.ts`: `resolveOrCreateCell` がセルトラッカーを参照することを確認
   - `addCellToNotebook` がセル追加後に `setCellCount` を呼ぶことを確認

2. **統合テスト**
   - `notebook_add_cell` → `execute_code`（`cell_index` 未指定）の連続実行で、正しいセルに出力されることを確認
   - 出力が二重化しないことを確認

3. **E2E テスト（Playwright MCP）**
   - **バグ再現シナリオ**: `notebook_add_cell` でセルを追加 → `execute_code`（`cell_index` 未指定）で実行 → ブラウザ上で正しいセルに出力が表示されることを確認
   - **Cell 0 集中の非再現確認**: 複数セルを追加・実行し、Cell 0 に他セルの出力が集中しないことをスクリーンショットで確認
   - **出力二重化の非再現確認**: セル実行後、各セルの出力が1回だけ表示されることを確認
   - **インデックス整合性**: `cell_added at index N` のログと `output added to cell N` のログが一致することをコンソールログで確認

4. **回帰テスト**
   - 既存の `execute-code.test.ts` と `ai-sync-flow.test.ts` が引き続きパスすることを確認
