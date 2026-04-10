# Issue #46: AI編集ロック中でもツールバーからのセル追加・実行が可能

## 関連タスク

- タスク番号: 8.5「ロック中のセル実行無効化」（`docs/plan/01-jupyter.md`）
  - 現在の完了条件はキーボードショートカットのみを対象としており、要件自体の見直しが必要

## ステータス

- [x] 起票
- [ ] 原因特定
- [ ] 修正方針レビュー完了
- [ ] 修正完了

## 症状

`ai_edit_start` でノートブックがロックされ、右上に「🔒 AI が編集中です...」インジケータが表示されている状態でも、ユーザーが以下の操作を実行できてしまう。

- ツールバーの「Insert a cell below (B)」ボタンでセル追加
- ツールバーの「Run this cell and advance」ボタンでセル実行
- （未検証だが同じ経路で以下も通る可能性が高い）Run メニューからの実行、コマンドパレットからの実行、右クリックメニューからの操作

`jupyterlab-ai-sync/src/lock-manager.ts` の `createExecutionBlockHandler` は `Shift/Ctrl/Cmd/Alt + Enter` のキーボードショートカットのみを capture フェーズでブロックしており、JupyterLab の command system 経由で発火する操作（toolbar / menu / command palette）はブロックされていない。セルエディタは `setAllCellsReadOnly` で read-only 化されるが、セル追加・セル実行コマンドはセルエディタを経由しないため素通りする。

結果として、本来「AI 編集中」にユーザーが触れてはいけないノートブックに対して、ユーザーがセル追加・セル実行・セル削除などの編集操作をすべて実行できてしまい、AI の編集とユーザーの編集が競合するリスクがある。

## 再現手順

1. JupyterLab を開き、任意のノートブックを開いた状態にする
2. 以下のリクエストで `ai_edit_start` イベントを送信してロックを発火させる

   ```bash
   curl -X POST "http://localhost:8888/api/ai/events/broadcast" \
     -H "Authorization: token dev-token" \
     -H "Content-Type: application/json" \
     -d '{"type":"ai_edit_start","notebook_path":"<ノートブックパス>"}'
   ```

3. 右上に「🔒 AI が編集中です...」が表示されることを確認する
4. ノートブックツールバーの「Insert a cell below (B)」ボタンをクリックする → **セルが追加される**
5. 任意のコードセルを選択し、ツールバーの「Run this cell and advance」ボタンをクリックする → **セルが実行される**（実行カウントが増加）

## 再現確認結果

- 再現: できた
- 確認方法: Playwright MCP による JupyterLab UI 操作 + `/api/ai/events/broadcast` への curl POST
- エビデンス:
  - スクリーンショット: [`docs/issues/evidence-ai-lock-bypass.png`](./evidence-ai-lock-bypass.png)
    - 右上に「🔒 AI が編集中です...」インジケータ表示中
    - セル `[1]:` が実行され `NameError` を出力（ツールバー「Run」で実行された証拠）
    - ノートブック末尾に新しい空のセルが追加されている
  - コンソールログ抜粋:
    - `[LockManager] Notebook locked: workspaces/production/ws-284e99d5/tool_verification.ipynb` はログされる
    - しかし `[LockManager] Blocked cell execution shortcut:` はログされない（toolbar クリックは keydown ハンドラを通過しないため）

## 期待する動作

`ai_edit_start` でロックされているノートブックに対しては、以下のすべての経路でセル追加・セル実行・セル編集・セル削除がブロックされる：

- キーボードショートカット（Shift+Enter、Ctrl/Cmd+Enter、A、B、D D 等）— 現在実装済み
- ノートブックツールバーのボタン — **現在未実装**
- メニューバー（Run、Edit 等）からのコマンド — **現在未実装**
- コマンドパレット — **現在未実装**
- 右クリックコンテキストメニュー — **現在未実装**

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
