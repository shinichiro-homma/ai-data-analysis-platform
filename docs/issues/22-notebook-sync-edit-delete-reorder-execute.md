# Issue #22: notebook_edit/delete/execute/reorder がブラウザにリアルタイム反映されない

## 関連タスク

- タスク番号: 16.1, 16.2, 17.1

## ステータス

- [x] 起票
- [ ] 原因特定
- [ ] 修正方針レビュー完了
- [ ] 修正完了

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

## 原因（調査後に記入）

## 修正方針（調査後に記入）

### 影響範囲

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `path/to/file` | （変更内容） |

### テスト計画
