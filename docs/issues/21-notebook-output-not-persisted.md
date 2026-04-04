# Issue #21: ブラウザ接続時にexecute_codeのセル出力がノートブックに永続化されない

## 関連タスク

- タスク番号: Jupyter 8.2（セル実行のリアルタイム同期）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

Claude Desktop から MCP 経由で分析フローを実行した際、コードの実行自体は成功するが、作成されたノートブックを JupyterLab で開くと全セルの `execution_count` が `None`、`outputs` が空配列になっている。

- ワークスペース: `ws-72cbc572`
- ノートブック: `loyalty_category_heatmap.ipynb`（3セルすべてが出力なし）
- エビデンス: `docs/issues/evidence-notebook-missing-outputs.png`

## 再現手順

1. JupyterLab をブラウザで開いた状態にする
2. Claude Desktop から MCP 経由で `workspace_create` → `session_create` → `notebook_create` → `notebook_add_cell` → `execute_code` の一連のフローを実行する
3. JupyterLab でノートブックを確認する
4. セルのコードは存在するが、実行結果（出力）が表示されない

## 再現確認結果

- 再現: できた
- 確認方法: Playwright でブラウザ上のノートブックを確認 + Jupyter REST API でノートブック内容を取得
- エビデンス:
  - スクリーンショット: `docs/issues/evidence-notebook-missing-outputs.png`
  - API レスポンスで全3セルの `execution_count=None`, `outputs=[]` を確認

## 原因の手がかり

`jupyter-mcp/src/tools/execute-code.ts:134-146` にて:

```typescript
// ブラウザが接続していない場合のみ、セル出力をディスクに永続化
if (hasCellPosition && lastBroadcastClientCount === 0) {
  await jupyterClient.updateCellOutputs(notebookPath, cellIndex, nbOutputs, result.execution_count);
}
```

ブラウザ接続時（`clients > 0`）はディスク書き込みをスキップし、`jupyterlab-ai-sync` 拡張の SharedModel 経由で永続化される想定。しかし、この経路で出力がノートブックファイルに反映されていない。

## 期待する動作

`execute_code` で実行したコードの出力が `.ipynb` ファイルに永続化され、後からノートブックを開いた際にも実行結果が表示される。

## 原因

### 根本原因

`jupyterlab-ai-sync` の `handleCellOutput` が OutputArea（UI 表示用）にのみ出力を追加し、SharedModel（`ISharedCodeCell.outputs`）に書き込んでいないため、JupyterLab の自動保存時に `outputs: []` のまま `.ipynb` が保存される。

### 詳細

2つのコンポーネントにまたがる問題:

1. **jupyter-mcp** (`src/tools/execute-code.ts:134-146`):
   - ブラウザ接続時 (`clients > 0`) に `updateCellOutputs()` による REST API 経由のディスク書き込みをスキップ
   - `jupyterlab-ai-sync` 拡張が SharedModel 経由で永続化する前提の設計

2. **jupyterlab-ai-sync** (`src/notebook-updater.ts:224-228`):
   - `handleCellOutput` で `outputArea.model.add(output)` のみ実行
   - コメントに「`OutputAreaModel` は SharedModel と双方向同期している」と記載されているが、JupyterLab 4.x では `OutputAreaModel.add()` は `ISharedCodeCell.outputs` に自動反映されない
   - `handleCellExecuteEnd` では `sharedCodeCell.execution_count = N` と SharedModel に書き込んでいるが、outputs に対する同等の処理がない

### 処理フロー（問題箇所）

```
jupyter-mcp: execute_code
  ├─ broadcastOutputEvents() → cell_output イベントをブラウザに配信
  │     └─ 戻り値: { clients: N } → N > 0 ならブラウザ接続中
  │
  ├─ if (clients === 0)
  │     └─ updateCellOutputs() → REST API でディスクに書き込み ✅
  │   else
  │     └─ スキップ → jupyterlab-ai-sync に委譲 ❌ ← ここで永続化が途切れる
  │
jupyterlab-ai-sync: handleCellOutput
  ├─ outputArea.model.add(output) → UI 表示には反映 ✅
  └─ sharedCodeCell.setOutputs() → 未実装 ❌ ← SharedModel 未更新

JupyterLab 自動保存
  └─ SharedModel.outputs が空 → .ipynb に outputs: [] で保存 ❌
```

## 修正方針

### アプローチ: jupyterlab-ai-sync で SharedModel に出力を書き戻す

`handleCellExecuteEnd` の末尾で、蓄積された出力を `ISharedCodeCell.setOutputs()` 経由で SharedModel に一括書き込みする。個々の `handleCellOutput` ではなく `handleCellExecuteEnd` で一括処理する理由:

- `cell_output` イベントは出力ごとに複数回発火するため、毎回 `setOutputs()` を呼ぶと不必要な SharedModel 更新が発生する
- `cell_execute_end` はセル実行完了時に1回だけ発火するため、最終的な出力セットを一括で書き込むのに適している
- 既に `execution_count` の SharedModel 書き込みがこのハンドラで行われており、ここに追加するのが自然

### 影響範囲

- 修正は `jupyterlab-ai-sync` コンポーネントのみ
- `jupyter-mcp` 側の条件分岐ロジックは変更不要（設計意図通り）
- 要件定義・API 仕様の変更は不要（実装が仕様を満たしていなかっただけ）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyterlab-ai-sync/src/notebook-updater.ts` | `handleCellExecuteEnd` 末尾に `sharedCodeCell.setOutputs()` を追加し、OutputArea の出力を SharedModel に書き戻す |
| `jupyterlab-ai-sync/src/notebook-updater.ts` | `handleCellOutput` のコメント修正（「双方向同期」の誤った記述を訂正） |

### テスト計画

1. **シナリオ A: ブラウザ非接続時の永続化確認**:
   - ブラウザを閉じた状態で MCP 経由で `session_create` → `notebook_create` → `notebook_add_cell` → `execute_code` を実行
   - テキスト出力（`print("hello")`）と画像出力（`matplotlib` グラフ）の両方を含むセルを実行
   - Jupyter REST API でノートブック内容を取得し、`outputs` と `execution_count` が永続化されていることを確認
   - 後からブラウザで JupyterLab を開き、セルの実行結果（テキスト・画像の両方）が表示されることを確認

2. **シナリオ B: ブラウザ接続時の永続化確認**:
   - ブラウザで JupyterLab を開いた状態で MCP 経由で `execute_code` を実行
   - テキスト出力と画像出力の両方を含むセルを実行
   - Jupyter REST API でノートブック内容を取得し、`outputs` と `execution_count` が永続化されていることを確認
   - ブラウザを閉じて再度開き、出力（テキスト・画像の両方）が保持されていることを確認

3. **検証観点（出力タイプ別）**:
   - テキスト出力（stdout）: `print()` の出力が永続化されること
   - 画像出力（display_data）: `matplotlib` のグラフが永続化されること
   - テキストのみ保存・画像未保存のような部分的な永続化失敗がないこと

4. **回帰テスト**:
   - `jupyter-mcp` の既存テスト (`scripts/test.sh jupyter-mcp`) が通ること
   - ブラウザ非接続時の既存ロジック（`updateCellOutputs` 経由の永続化）が変わらないこと

5. **JupyterLab 拡張のリビルド**:
   - `jupyterlab-ai-sync` をビルドし、Docker コンテナにデプロイして動作確認
