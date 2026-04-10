# Issue #46: AI編集ロック中でもツールバーからのセル追加・実行が可能

## 関連タスク

- タスク番号: 8.5「ロック中のセル実行無効化」（`docs/plan/01-jupyter.md`）
  - 現在の完了条件はキーボードショートカットのみを対象としており、要件自体の見直しが必要

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

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

## 原因

### 根本原因

`jupyterlab-ai-sync/src/lock-manager.ts` のロック実装が、ユーザー入力の経路のうち **キーボードショートカット** と **セルエディタの read-only 化** の 2 つしかカバーしていない。

| 経路 | 現在の対策 | 結果 |
|-----|-----------|------|
| `Shift/Ctrl/Cmd/Alt + Enter` のキーボードショートカット | `createExecutionBlockHandler` (`lock-manager.ts:123-138`) が capture フェーズで `preventDefault` + `stopPropagation` | ✓ ブロック |
| セルエディタへの直接タイプ入力 | `setAllCellsReadOnly` (`lock-manager.ts:143-150`) で全セルエディタを read-only 化 + `sharedModel.changed` で新規セルにも追従 | ✓ ブロック |
| ツールバーボタン（Insert a cell below / Run this cell） | **対策なし** | ✗ 素通り |
| Run / Edit メニュー | **対策なし** | ✗ 素通り |
| コマンドパレット（Cmd+Shift+P） | **対策なし** | ✗ 素通り |
| 右クリックコンテキストメニュー | **対策なし** | ✗ 素通り |

ツールバー・メニュー・コマンドパレット・右クリックメニューはいずれも JupyterLab の `app.commands.execute('notebook:...')`（`CommandRegistry`）経由で発火する。`lock-manager.ts` では `CommandRegistry` を一切フックしておらず（`@jupyterlab/application` の `app.commands` への参照ゼロ）、これらの経路がすべて素通りしている。

セルエディタの read-only 化は「セルの中身をタイプ編集する操作」しか防げず、「セルを追加する／既存セルを実行する／セルを削除する」操作はセルエディタを経由しないため効果がない。

### 関連ファイルと行番号

- `jupyterlab-ai-sync/src/lock-manager.ts:28-64` — `lockNotebook`（現状はキーボードハンドラ登録 + read-only 化のみ）
- `jupyterlab-ai-sync/src/lock-manager.ts:69-104` — `unlockNotebook`（解除側。今回追加するフックの解除もここで対称に行う）
- `jupyterlab-ai-sync/src/lock-manager.ts:123-138` — `createExecutionBlockHandler`（キーボードショートカットのみブロック）
- `jupyterlab-ai-sync/src/lock-manager.ts:10-15` — `LockState` インターフェース（unlock 時に解除すべきハンドラを保存する場所）
- `jupyterlab-ai-sync/src/plugin.ts:26` — `LockManager` 生成箇所（既に `app: JupyterFrontEnd` を渡しているため、`app.commands` は `LockManager` 内から参照可能）

### 要件と実装のギャップ

`docs/requirements/jupyterlab-ai-sync.md` の **F3.1 ロック開始** には次のように記載されている。

> ユーザーのキーボード入力、セル編集、セル実行を無効化する

**「セル実行を無効化する」** は操作手段に依存しない記述であり、ツールバー・メニュー・コマンドパレットを含むすべての経路を無効化する意図と解釈するのが自然。よって本件は **実装側のバグ** であり、要件定義の変更は不要。

ただし、要件本文が「キーボード入力」「セル編集」「セル実行」を並列に列挙しており、実装者が「キーボード入力経路だけを塞げばよい」と読み違える余地がある。要件側の文言改善は将来のリファクタリングで検討してよいが、本 Issue のスコープ外とする（実装が要件の本意に追従すれば仕様として満たされるため）。

## 修正方針

### アプローチ: `app.commands.execute` をラップしてロック中の対象コマンドをブロックする

JupyterLab の `CommandRegistry`（`@lumino/commands`）には「コマンド実行前」を捕まえる公式シグナルが存在しない（`commandExecuted` シグナルは実行**後**に発火するためブロック不能）。よって、`LockManager` 起動時に **`app.commands.execute` を一度だけラップ**し、ロック中ノートブックがアクティブな場合に限り `notebook:*` 系コマンドの実行を抑止する。

#### 動作

1. `LockManager` のコンストラクタで `app.commands.execute` を一度だけラップする（idempotent ガード付き）
2. ラッパーは以下を判定する:
   - ブロック対象コマンド ID（`BLOCKED_COMMAND_IDS` セット）に該当するか
   - 現在アクティブなノートブック（`notebookTracker.currentWidget`）のパスが `lockedNotebooks` に含まれるか
3. 両方を満たす場合、`Promise.resolve(undefined)` を返して実行を中断し、`console.warn` で記録する
4. それ以外は元の `execute` を呼び出す

#### ブロック対象コマンド ID（初期セット）

JupyterLab 4.x の標準 `notebook:*` コマンドのうち、セルの追加・実行・編集・削除・並び替えに関わるものを列挙する。

| 操作カテゴリ | コマンド ID |
|-------------|------------|
| セル実行 | `notebook:run-cell`, `notebook:run-cell-and-select-next`, `notebook:run-cell-and-insert-below`, `notebook:run-in-console`, `notebook:run-all-cells`, `notebook:run-all-above`, `notebook:run-all-below`, `notebook:restart-run-all`, `notebook:restart-and-run-to-selected` |
| セル追加 | `notebook:insert-cell-above`, `notebook:insert-cell-below` |
| セル削除 | `notebook:delete-cell` |
| セル切り取り/貼付 | `notebook:cut-cell`, `notebook:paste-cell-above`, `notebook:paste-cell-below`, `notebook:paste-and-replace` |
| セル並び替え | `notebook:move-cell-up`, `notebook:move-cell-down` |
| セル分割/結合 | `notebook:split-cell-at-cursor`, `notebook:merge-cells`, `notebook:merge-cell-above`, `notebook:merge-cell-below` |
| セル種別変更 | `notebook:change-cell-to-code`, `notebook:change-cell-to-markdown`, `notebook:change-cell-to-raw` |

カーネル中断は要件 F3.3 で「ロック中も有効」と明示されているため、`kernelmenu:interrupt` / `notebook:interrupt-kernel` 等は **ブロック対象に含めない**。

#### `unlock` 時の動作

`unlockNotebook` および `unlockAll` は `lockedNotebooks` Map から該当エントリを削除する。ラッパー側は呼び出し時に `lockedNotebooks` を動的に参照するため、Map の状態が変わるだけでロック解除は反映され、追加の解除処理は不要。これによりラップ・解除を per-lock で行う複雑さを避けられる。

### 代替案の検討（採用しない）

| 案 | 理由 |
|----|------|
| `commandExecuted` シグナルで監視 | 実行**後**に発火するためブロック不能。すでに変更が走った後では遅い |
| 各コマンドを `addCommand` で再登録して上書き | `CommandRegistry` は同一 ID の再登録でエラーになる |
| 各コマンドの `isEnabled` を上書き | `isEnabled` のオプションは `addCommand` 時点で指定する関数。後付けで差し替え不可 |
| `notebookPanel.model.cells.changed` で変更を検知して revert | 一瞬変更が走った後に巻き戻すため UX が悪く、競合状態のリスクもある |
| 全 `notebook:*` コマンドを列挙せず prefix で blanket ブロック | カーネル中断や閲覧系コマンド（`notebook:scroll-cell-center` 等）まで巻き込む。明示的な許可リスト方式の方が安全 |

### 影響範囲

#### 修正対象コンポーネント

- `jupyterlab-ai-sync` のみ

他コンポーネント（jupyter-server / jupyter-mcp / document-server / document-mcp）への影響なし。要件定義 / API 仕様 / DB スキーマの変更も不要。

#### 機能への影響

- AI 編集ロック中: ツールバー / メニュー / コマンドパレット / 右クリックからのセル操作がすべて警告ログ付きでブロックされる（期待動作）
- ロックされていないノートブックの操作: ラッパーは `currentWidget` のパスがロック中の場合のみ `Promise.resolve()` を返すため、影響なし
- AI 自身による編集: AI の編集は `notebook-updater.ts` 経由でモデルを直接操作しており、`app.commands.execute` を経由しない。よって影響なし
- カーネル中断: ブロック対象に含めないため、ロック中も従来通り機能する（要件 F3.3 を満たす）
- プラグイン非アクティブ時: `LockManager` のコンストラクタが呼ばれない限りラップは行われないため、テスト環境等への副作用なし

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyterlab-ai-sync/src/lock-manager.ts` | (1) `BLOCKED_COMMAND_IDS` 定数（モジュールトップに `Set<string>`）を追加。(2) `LockManager` に `private commandsWrapped = false` フィールドを追加し、コンストラクタで `installCommandBlocker()` を呼ぶ。(3) `installCommandBlocker()` メソッドを追加: `app.commands.execute` を保持して新しい関数で差し替える。新しい関数は `BLOCKED_COMMAND_IDS.has(id) && this.isCurrentNotebookLocked()` の場合に `Promise.resolve(undefined)` を返し、`console.warn` で記録する。それ以外は元の execute に委譲する。(4) `private isCurrentNotebookLocked(): boolean` を追加: `notebookTracker.currentWidget` のパスを `normalizeNotebookPath` で正規化して `lockedNotebooks.has` で判定。(5) 既存の `lockNotebook` / `unlockNotebook` には変更を加えない（ラッパーは Map を動的に参照するため per-lock の登録/解除不要）。 |
| `docs/issues/46-ai-lock-bypass-toolbar.md` | 設計記録（本ファイル）の更新 |

要件定義 (`docs/requirements/jupyterlab-ai-sync.md`) は変更しない。実装が既存要件 F3.1「セル実行を無効化する」の本意に追従するだけのため。

### テスト計画

`jupyterlab-ai-sync` には現時点でユニットテスト基盤が存在しない（`tests/` ディレクトリ・jest/vitest 等の依存関係いずれも未導入。`scripts/test.sh` のターゲットコンポーネントにも含まれない）。本 Issue のスコープでテスト基盤を新設するのは過剰なため、以下の 2 段構えで検証する。

#### 1. 静的検証（自動）

- `npm run build`（`jupyterlab-ai-sync/`）で `tsc` の型チェックがパスすること
- jupyter-server コンテナのリビルドで extension のバンドルが成功すること（`scripts/rebuild.sh jupyter-server`）

#### 2. 動的検証（Playwright MCP による手動 UI 操作）

Issue 起票時と同じ手順で Playwright MCP を使い、修正前後の挙動差を確認する。

**事前準備**:
1. `scripts/rebuild.sh jupyter-server` で jupyterlab-ai-sync を含めて再ビルド
2. ブラウザで JupyterLab を開き、任意のノートブック（例: `tool_verification.ipynb`）を開く
3. `curl -X POST http://localhost:8888/api/ai/events/broadcast -H "Authorization: token dev-token" -H "Content-Type: application/json" -d '{"type":"ai_edit_start","notebook_path":"<path>"}'` でロックを発火
4. 「🔒 AI が編集中です...」インジケータが表示されていることを確認

**確認項目（ロック中はすべてブロックされること）**:

| # | 操作 | 期待される挙動 |
|---|------|---------------|
| T1 | ツールバー「Insert a cell below (B)」をクリック | セルが追加されない / コンソールに `[LockManager] Blocked command:` 警告 |
| T2 | 任意のコードセルを選択し、ツールバー「Run this cell and advance」をクリック | 実行されず実行カウントが増えない / 警告ログ |
| T3 | メニューバー Run → Run Selected Cells | 実行されない / 警告ログ |
| T4 | メニューバー Run → Run All Cells | 実行されない / 警告ログ |
| T5 | コマンドパレット (Cmd/Ctrl+Shift+P) → "Run Selected Cells" | 実行されない / 警告ログ |
| T6 | コマンドパレット → "Insert Cell Below" | セルが追加されない / 警告ログ |
| T7 | セル右クリック → "Delete Cells" | 削除されない / 警告ログ |
| T8 | キーボードショートカット `Shift+Enter`（既存実装の回帰確認） | 実行されない / 既存の `Blocked cell execution shortcut` ログ |

**ロック解除後の確認項目（リグレッションがないこと）**:

5. `curl -X POST .../broadcast -d '{"type":"ai_edit_end","notebook_path":"<path>"}'` でロック解除
6. インジケータが消えることを確認
7. 上記 T1〜T7 の操作がすべて正常に動作すること（セル追加・実行・削除が成功する）
8. キーボードショートカット `Shift+Enter` が正常に動作すること

**ロック中でないノートブックへの影響確認**:

9. 別のノートブック B を開き、ノートブック A だけを `ai_edit_start` でロックする
10. ノートブック B にフォーカスを移し、T1〜T7 の操作がすべて正常に動作することを確認（`currentWidget` が B のためブロック対象外）

#### 3. 既存機能の回帰確認

- AI による編集（`cell_added` / `cell_edited` / `cell_execute_*` イベント受信）が引き続き正常に反映されることを Playwright で確認（AI の編集は `notebook-updater.ts` 経由のモデル直接操作のため、ラッパーの影響を受けないことの実機確認）
- WebSocket 切断による `unlockAll` が正常に動作すること（jupyter-server を一時停止 → ラッパーが残っていてもロック中ノートブックがゼロになるため全コマンドが通ること）
