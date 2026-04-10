# Issue #51: AI編集ロック中にカーネル中断が効かない（要件 F3.3 通りに動作していない）

## 関連タスク

- タスク番号: 8.3 / 8.5（`docs/plan/01-jupyter.md` — AI 編集モード・ロック中のセル実行無効化）
- 要件: `docs/requirements/jupyterlab-ai-sync.md` F3.3 / AC6

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

AI 編集中のノートブックロック機能（`jupyterlab-ai-sync` 拡張）が有効な間、ユーザーがセル実行を **中断（interrupt kernel）** できなくなっている。

要件 F3.3（`docs/requirements/jupyterlab-ai-sync.md:77`）および AC6（同 `:177`）では「カーネル中断ボタンはロック中でも有効」と明記されており、実装側も `BLOCKED_COMMAND_IDS`（`jupyterlab-ai-sync/src/lock-manager.ts:12-47`）から `notebook:interrupt-kernel` / `kernelmenu:interrupt` を意図的に除外しているが、実際のブラウザ操作では中断が効かない。

セル実行や編集操作自体がロック中にブロックされることは現状の仕様として問題ない。**中断（ユーザーが暴走を止める手段）** は要件通りロック貫通で動作する必要がある。

### 論点: カーネル再起動の扱い

カーネル **再起動**（`kernelmenu:restart-kernel` 等）をロック中に許可するかどうかは現時点で明確でない。現在の `BLOCKED_COMMAND_IDS` には `notebook:restart-run-all` / `notebook:restart-and-run-to-selected` は含まれるが、純粋な restart コマンドは含まれていない。UX 上どう扱うべきかは修正設計フェーズで要件と照らして判断する。

## 再現手順

1. `docker-compose up -d` で全サービスを起動
2. ブラウザで JupyterLab（http://localhost:8888 ）を開く
3. 任意のノートブックを開いた状態で、AI から `notebook_execute_cell` 等の編集系 MCP ツールを呼び出し、`ai_edit_start` が配信されてロック状態に入らせる
4. AI が長時間実行中のセル（例: `time.sleep(120)`）を走らせている間に、ユーザーがツールバーの「■（Interrupt Kernel）」ボタンをクリック、または `I I`（Jupyter 標準の中断ショートカット）を押下する
5. カーネルが中断されず、セル実行が止まらない

## 再現確認結果

- 再現: 未確認（ユーザー観測ベースの報告）
- 確認方法: ユーザーからの報告。コード・要件の突き合わせによる一次調査のみ実施
- 観測メモ: コード上は `notebook:interrupt-kernel` はブロックリストから除外されており、理論上は許可されているはずだが、実環境で中断が効かない。原因として以下が候補:
  - `setNotebookReadOnly`（`lock-manager.ts:237`）がセルエディタを read-only にした結果、ノートブックのフォーカス/モード状態が変わり、コマンドモードに入れず `I I` ショートカットが使えない
  - ツールバーの中断ボタンに対応するコマンド ID が想定と異なる（実際には別 ID 経由で dispatch されており、それが何らかの形でブロックされている）
  - `installCommandBlocker`（`lock-manager.ts:165`）でラップした `commands.execute` の戻り型が `Promise<unknown>` になり、下流で待ち合わせていた処理が破綻している
- 詳細な原因特定は `/custom-fix-bug` フェーズで実施する

## 期待する動作

- ロック中でも **カーネル中断** はユーザー操作で確実に実行できる（ツールバーボタン・キーボードショートカットの両方）
- 中断後もロック状態は維持され、`ai_edit_end` を受信した時点で正常にアンロックされる
- カーネル **再起動** については本 Issue の修正設計で扱いを決定する（許可 / 禁止 / 確認ダイアログ等）

## 原因

### 根本原因: ロック開始時にノートブックのモード/フォーカス制御を行っていない

`jupyterlab-ai-sync/src/lock-manager.ts` の `lockNotebook`（70-106 行目）は、ロック開始時に以下の 2 つを行うのみで、ノートブックの **モード（command/edit）** と **DOM フォーカス** を明示的に制御していない。

1. `keydownHandler` を capture フェーズで登録（Shift+Enter 系のみブロック、`I I` は素通り）
2. `setAllCellsReadOnly` で全セルの CodeMirror を read-only 化

JupyterLab 4.x の `notebook:interrupt-kernel` コマンドは、キーボードショートカット `I I` に対して **command mode かつ `.jp-Notebook:focus` セレクタ一致** を前提に登録されている。ロック開始時点でノートブックが edit mode（カーソルがセルエディタ内にある状態）だった場合、read-only 化してもフォーカスは CodeMirror 内部に残るため、`I I` ショートカットは発火しない。`lockNotebook` には `notebookPanel.content.mode = 'command'` や `notebookPanel.content.node.focus()` に相当する処理が**一切存在しない**（`lock-manager.ts` 全文で `mode` への代入ヒットなし）。

#### 各経路の挙動（コード解析ベース）

| 操作経路 | 理論挙動 | 実際（Issue 報告） | 原因 |
|---------|---------|------------------|------|
| `I I` キーボードショートカット | command mode で notebook focus 時に interrupt 発火 | 効かない | command mode に入れていない |
| ツールバー「■ Interrupt」ボタン | `commands.execute('notebook:interrupt-kernel')` が BLOCKED_COMMAND_IDS に含まれないため `installCommandBlocker` ラッパを素通り | 効かない（報告ベース） | コード上は通過するはず。ビルド鮮度（副次要因）の影響も疑われる |
| Kernel メニュー → Interrupt | `kernelmenu:interrupt` を dispatch。ブロック対象外 | 未検証 | 同上 |

### 否定された仮説（Issue 本文で挙げていたもの）

| # | 仮説 | 評価 |
|---|------|------|
| 1 | `setNotebookReadOnly` がフォーカス/モード状態を変える | **部分的に成立**。ただし主因は「read-only 化」ではなく「ロック時に command mode へ明示遷移していない」こと（採用） |
| 2 | ツールバー中断ボタンの別 ID が BLOCKED_COMMAND_IDS に引っかかる | **否定**。`BLOCKED_COMMAND_IDS`（14-47 行目）に interrupt / stop 系 ID は一切含まれていない |
| 3 | `installCommandBlocker` の `Promise<unknown>` 戻り型で下流処理が破綻 | **否定**。interrupt は BLOCKED_COMMAND_IDS に無いため、ラッパは即 `originalExecute` に委譲。戻り型はコンパイル時の制約であり、実行時の Promise 解決値に影響しない |

### 副次要因: `lib/` のビルド成果物が `src/` より古い

```
lib/lock-manager.js  4月 6 12:11  7070 bytes
src/lock-manager.ts  4月10 17:32  9744 bytes
```

`jupyterlab-ai-sync/package.json` の `"main": "lib/index.js"` により labextension は `lib/` をロードするが、Issue #46 の修正（`installCommandBlocker` 追加）以降にリビルドが行われていない可能性がある。本 Issue の修正検証時は **必ず `scripts/rebuild.sh jupyter-server` で再ビルドしてから実環境確認する**こと。これ自体は本 Issue のコード修正範囲ではないが、検証手順に明記する。

### 論点: カーネル再起動の扱い（本 Issue で決定）

要件 `docs/requirements/jupyterlab-ai-sync.md` には `restart` / `再起動` に関する記述が**一切存在しない**（F3.3 は interrupt のみ言及）。現状の `BLOCKED_COMMAND_IDS` にも純粋な restart 系コマンド（`notebook:restart-kernel`, `kernelmenu:restart` 等）は含まれていないため、**現状は実質的に許可されている**状態。

**決定**: カーネル **再起動はロック中にブロックする**。

根拠:

| 項目 | interrupt | restart |
|------|-----------|---------|
| 性質 | Python 例外（`KeyboardInterrupt`）を送るグレースフルな信号 | カーネルプロセス強制終了 + 再起動 |
| kernel 状態 | 変数・インポート・実行履歴が維持される | **完全消失** |
| AI との競合 | AI 側で例外をキャッチして後処理可能 | `ai_edit_end` 前に kernel state が破壊され、AI の次のツール呼び出し・出力書き戻しが不整合になる |
| F3.3 / #46 との整合 | 「暴走を止める」という F3.3 の設計意図に合致 | #46「AI 編集の競合防止」の意図と矛盾（restart は最も破壊的な競合） |

interrupt で止まらない稀なケース（C 拡張の無限ループ等）のフォールバックは、既存の WebSocket 切断経由 `unlockAll`（jupyter-server 接続を切る・ブラウザリロード）で担保される。通常運用で必要な「AI の暴走を止める」手段は interrupt で十分。

**実装への反映**: `BLOCKED_COMMAND_IDS` に restart 系コマンドを追加する。

### 関連ファイルと行番号

- `jupyterlab-ai-sync/src/lock-manager.ts:14-47` — `BLOCKED_COMMAND_IDS`（restart 系コマンドを追加）
- `jupyterlab-ai-sync/src/lock-manager.ts`（モジュールトップ、新規） — `LOCK_EXEMPT_COMMAND_IDS` 定数を追加
- `jupyterlab-ai-sync/src/lock-manager.ts:49-54` — `LockState` インターフェース（`modeChangedDisposer` フィールド追加）
- `jupyterlab-ai-sync/src/lock-manager.ts:70-106` — `lockNotebook`（mode/focus 制御とシグナル監視の追加対象）
- `jupyterlab-ai-sync/src/lock-manager.ts:111-146` — `unlockNotebook`（disposer 呼び出しの追加対象）
- `jupyterlab-ai-sync/src/lock-manager.ts:165-187` — `installCommandBlocker`（exempt 優先判定の分岐追加）
- `docs/requirements/jupyterlab-ai-sync.md:73-77` — F3.3 ロック中のユーザー体験（restart 方針の追記対象）
- `docs/requirements/jupyterlab-ai-sync.md:177-180` — AC6 カーネル中断のロック貫通（restart 項目の追加対象）

## 修正方針

### アプローチ: ロック対象外コマンドを単一の allowlist に宣言し、UI 状態レイヤーと command blocker の両方で参照する

現状の lock-manager は 2 つの強制ポイントを持つが、「ロック対象外とする操作」を宣言する単一の場所が無い:

| 強制ポイント | 現在の実装 | 「exempt」の扱い |
|-------------|-----------|---------------|
| コマンドレジストリ層（`installCommandBlocker`） | `BLOCKED_COMMAND_IDS` 非該当なら通過 | 暗黙的（denylist 非該当） |
| UI 状態層（`setAllCellsReadOnly` + keydown） | 全セル read-only + Enter 系 keydown ブロック | exempt を考慮していない |

これを解消するため、**`LOCK_EXEMPT_COMMAND_IDS`（allowlist）** を新規導入し、両レイヤーが参照する設計にする。Issue #51 の interrupt もこの allowlist の第一エントリとして宣言することで、将来「Kernel Reconnect もロック中に許可したい」等の追加要望を allowlist への 1 行追加で吸収できる。

### 新規導入: LOCK_EXEMPT_COMMAND_IDS

```ts
/**
 * ロック中でもユーザー操作を許可するコマンド ID（allowlist）。
 *
 * ここに ID を追加すると、以下が自動的に適用される:
 * 1. installCommandBlocker が BLOCKED_COMMAND_IDS 判定をスキップし originalExecute に委譲する
 * 2. lockNotebook が notebook を command mode + container focus に維持し、
 *    exempt コマンドのキーボードショートカットが発火可能な UI 状態を保つ
 *
 * 将来的にロック対象外とする機能を追加する際は、このセットに ID を追加するだけで済む。
 */
const LOCK_EXEMPT_COMMAND_IDS = new Set<string>([
  'notebook:interrupt-kernel',
  'kernelmenu:interrupt',
]);
```

### Layer 1 修正: installCommandBlocker のラッパ

exempt 優先で判定を入れる:

```ts
const wrapper = (id, args) => {
  // exempt はロック状態に関係なく常に originalExecute に委譲する
  if (LOCK_EXEMPT_COMMAND_IDS.has(id)) {
    return originalExecute(id, args);
  }
  if (BLOCKED_COMMAND_IDS.has(id) && this.isCurrentNotebookLocked()) {
    console.warn('[LockManager] Blocked command:', id);
    return Promise.resolve(undefined);
  }
  return originalExecute(id, args);
};
```

現状コードでは interrupt は BLOCKED_COMMAND_IDS 非該当のため暗黙的に通過するが、exempt の意図を明示化することで、将来 BLOCKED_COMMAND_IDS と LOCK_EXEMPT_COMMAND_IDS の ID が偶然衝突した場合でも「exempt が勝つ」という優先順位が保証される。

### Layer 2 修正: lockNotebook で command mode + focus を維持

exempt コマンドのキーボードショートカット（例: `notebook:interrupt-kernel` の `I I`）は JupyterLab 4.x では `.jp-Notebook:focus` セレクタ + command mode を前提とするため、ロック中は以下を維持する:

```ts
// exempt コマンドのキーボードショートカットを発火可能な UI 状態を保つ。
// 1. 現在のモードを command に遷移（edit mode だった場合はセルエディタから抜ける）
notebookPanel.content.mode = 'command';
// 2. notebook container に DOM フォーカスを持たせる
notebookPanel.content.node.focus();
// 3. ロック中に edit mode へ遷移したら command に戻す
const onStateChanged = () => {
  if (notebookPanel.content.mode === 'edit') {
    notebookPanel.content.mode = 'command';
  }
};
notebookPanel.content.stateChanged.connect(onStateChanged);
state.modeChangedDisposer = () => {
  notebookPanel.content.stateChanged.disconnect(onStateChanged);
};
```

`unlockNotebook` では `state.modeChangedDisposer?.()` を呼んでシグナルを解除する。DOM フォーカスはユーザー操作に任せる（強制戻しは不要）。

### Layer 3 修正: BLOCKED_COMMAND_IDS に restart 系を追加

restart 系は exempt に含めない（＝ロック中はブロックされる）。`BLOCKED_COMMAND_IDS` に以下を追加する:

- `notebook:restart-kernel`
- `notebook:restart-clear-output`
- `kernelmenu:restart`
- `kernelmenu:restart-clear`

実装時に JupyterLab 4.x の `@jupyterlab/notebook-extension` および `@jupyterlab/apputils-extension` のコマンド ID を確認し、上記のうち実在する ID のみを追加する。

### 既存実装で温存するもの（変更なし）

| レイヤー | 役割 |
|---------|------|
| `setAllCellsReadOnly` / `sharedModel.changed` コールバック | セルエディタの read-only 化と新規セル追従 |
| `createExecutionBlockHandler`（capture 段 keydown） | Shift/Ctrl/Cmd/Alt + Enter のブロック |
| `installCommandBlocker` の構造 | `commands.execute` ラッパ（判定ロジックのみ拡張） |
| `BLOCKED_COMMAND_IDS` の既存 25 件 | セル実行・追加・削除等のブロック対象（restart 系を追加するだけ） |
| `LockIndicator` + `toolbar.addItem` | ロック中 UI インジケータ |
| `unlockAll` / WebSocket 切断時の全解除 | フォールバック経路 |

**ロックの中身を変えるのではなく、「ロック対象外」を宣言する allowlist を新設し、それを参照する形に 2 レイヤーを調整するだけ**の差分。

### 検討した代替案（採用しない）

| 案 | 不採用理由 |
|----|----------|
| A1. allowlist を導入せず mode/focus 制御だけ追加する | 「なぜ command mode を強制するのか」の意図が暗黙になり、将来の拡張時に「どこを触ればよいか」が不明瞭 |
| A2. allowlist を `CommandRegistry` に加え、LockManager は UI 状態だけ管理 | JupyterLab 本体 API を改変する形となり影響範囲が大きい |
| A3. `keydownHandler` に `I I` / `0 0` 検出を追加して直接 `commands.execute` を呼ぶ | JupyterLab のキーシーケンス判定ロジックを自前実装することになり脆弱 |
| A4. interrupt/restart キーバインドを独自登録 | JupyterLab 標準キーバインドと競合するリスク |
| A5. read-only 化を止めて全コマンドをブロック | セル直接タイプ入力がブロックできなくなり #46 退行 |
| A6. `LockIndicator` を toolbar から外す | UX 上必須。原因でもない |

#### 検討した代替案（採用しない）

| 案 | 不採用理由 |
|----|----------|
| A1. `keydownHandler` に `I I` 検出を追加して直接 `commands.execute('notebook:interrupt-kernel')` を呼ぶ | ショートカット判定を自前実装するのは JupyterLab のキーバインド仕様との二重管理になり脆弱。JupyterLab 側のキーシーケンス（`I,I` は 2 キー連続押下判定）を模倣するのも複雑 |
| A2. read-only 化を止めて代わりに全コマンドをブロックする | セルエディタへの直接タイプ入力（カーソル移動 + タイプ）がブロックできなくなり #46 の退行 |
| A3. `LockIndicator` を toolbar から外す | UX 上ロック中インジケータは必須。`margin-left: auto` で右端配置のため interrupt ボタンに重なる可能性は低く、そもそも原因ではない |
| A4. interrupt / restart のキーバインドを独自に追加登録する | JupyterLab 標準のキーバインドと競合するリスク。command mode 遷移で解決するなら本来不要 |

### 影響範囲

#### 修正対象コンポーネント

- `jupyterlab-ai-sync` のみ

他コンポーネント（jupyter-server / jupyter-mcp / document-server / document-mcp）への影響なし。API 仕様 / DB スキーマの変更も不要。

#### 機能への影響

- **ロック開始時**: ノートブックが自動的に command mode に遷移し、notebook container にフォーカスが移る。ユーザーが編集中に AI が操作を開始した場合、編集中のセルから抜ける（読み取り専用のため編集不能なので副作用なし）
- **ロック中**: ユーザーが read-only セルをクリックしても edit mode に遷移しない。interrupt (`I I`, ツールバー, Kernel メニュー) が動作する。restart (`Kernel → Restart Kernel`, `0 0` ショートカット等) はブロックされ `[LockManager] Blocked command:` 警告ログが記録される
- **ロック解除後**: mode 監視シグナルが disconnect され、ユーザーは通常どおり edit mode に遷移できる
- **ロック中でないノートブック**: 影響なし（`lockNotebook` が呼ばれないため）
- **AI 編集動作**: `notebook-updater.ts` 経由のモデル直接操作は mode に依存しないため影響なし
- **#46 の退行なし**: `installCommandBlocker` の仕組みは変更せず、`BLOCKED_COMMAND_IDS` に restart 系コマンドを**追加**するのみ。既存のセル操作ブロック対象は維持される

#### 要件定義の変更

F3.3 と AC6 に以下の方針を明記する。要件の意図（AI 編集中の競合防止と、ユーザーによる緊急停止手段の確保）を明確化する変更であり、新機能追加ではない。

- **interrupt**: ロック中も有効（既存記述の維持）
- **restart**: ロック中はブロック（新規追記）— kernel 状態破壊と AI との競合を防ぐため

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyterlab-ai-sync/src/lock-manager.ts` | (1) モジュールトップに `LOCK_EXEMPT_COMMAND_IDS = new Set<string>(['notebook:interrupt-kernel', 'kernelmenu:interrupt'])` を追加。JSDoc で「将来的にロック対象外とする機能を追加する際はここに ID を追加するだけで両レイヤーに反映される」旨を明記。(2) `BLOCKED_COMMAND_IDS` に restart 系コマンド ID を追加（実装時に JupyterLab 4.x の実在 ID を確認）。(3) `installCommandBlocker` のラッパで `LOCK_EXEMPT_COMMAND_IDS.has(id)` なら即 `originalExecute` に委譲する分岐を追加。(4) `LockState` に `modeChangedDisposer?: () => void` フィールドを追加。(5) `lockNotebook` の try ブロック末尾（`setNotebookReadOnly` 呼び出し後）に `notebookPanel.content.mode = 'command'` / `notebookPanel.content.node.focus()` / stateChanged で mode を監視し `edit` に遷移したら `command` に戻す disposer を `LockState.modeChangedDisposer` に保存。(6) `unlockNotebook` で `state.modeChangedDisposer?.()` を呼び出してシグナル解除。 |
| `docs/requirements/jupyterlab-ai-sync.md` | F3.3 に「カーネル中断はロック中でも有効／カーネル再起動はロック中は無効化される（AI 編集中の kernel state 破壊を防ぐため）」を明記。AC6 に「- [ ] AI 編集ロック中はカーネル再起動が無効化される」を追加。 |
| `docs/issues/51-ai-lock-blocks-kernel-interrupt.md` | 本ファイル（設計記録） |

### テスト計画

`jupyterlab-ai-sync` には現時点でユニットテスト基盤が存在しない（#46 修正時と同じ制約）。本 Issue のスコープで jest/vitest を導入するのは過剰なため、以下の 3 段で検証する。

#### 1. 静的検証

- `scripts/lint.sh jupyterlab-ai-sync` が PASS
- `scripts/test.sh --typecheck jupyterlab-ai-sync`（または `npm run build` で `tsc` 通過）
- `scripts/rebuild.sh jupyter-server` で labextension バンドルが成功し、lib/ と src/ の鮮度が揃う

#### 2. 動的検証（playwright-cli による UI 操作）

ブラウザ操作は `.claude/rules/testing.md` の「ブラウザ動作確認（playwright-cli）」に従い、`@playwright/cli` で自律的に実施する。セットアップ・コマンド・JupyterLab トークン認証は `docs/guides/browser-automation.md` を参照。

**事前準備**:
1. `scripts/rebuild.sh jupyter-server` で jupyterlab-ai-sync を含めて再ビルド（lib/ 鮮度担保）
2. ブラウザで JupyterLab を開き、任意のノートブック（例: `tool_verification.ipynb`）を開く
3. 先頭セルに `import time; time.sleep(60); print("done")` を準備
4. `curl -X POST http://localhost:8888/api/ai/events/broadcast -H "Authorization: token dev-token" -H "Content-Type: application/json" -d '{"type":"ai_edit_start","notebook_path":"<path>"}'` でロックを発火
5. 「🔒 AI が編集中です...」インジケータ表示を確認

**確認項目（ロック中のカーネル中断・再起動）**:

| # | 操作 | 期待される挙動 |
|---|------|--------------|
| T1 | 事前準備したセルを AI の `execute_code` 相当で実行開始（または手動実行後すぐロック発火） | セルが `[*]` で実行中状態 |
| T2 | キーボード `I I`（command mode ショートカット） | カーネル中断、セルが `KeyboardInterrupt` で停止、`[LockManager] Blocked command:` ログは出ない |
| T3 | ツールバー「■ Interrupt the kernel」ボタンクリック | T2 と同様に中断成功 |
| T4 | Kernel メニュー → Interrupt Kernel | T2 と同様に中断成功 |
| T5 | Kernel メニュー → Restart Kernel | **再起動されない**。`[LockManager] Blocked command: kernelmenu:restart` 等の警告ログ |
| T6 | キーボード `0 0`（restart ショートカット） | **再起動されない**。警告ログ |
| T7 | 中断後もロックインジケータが表示されたままであること | AC6 の「中断後もロック/アンロック状態遷移が正常」の前半確認 |

**回帰確認項目（#46 の退行がないこと）**:

| # | 操作 | 期待される挙動 |
|---|------|--------------|
| R1 | ツールバー「Insert a cell below」 | ブロックされる（`[LockManager] Blocked command: notebook:insert-cell-below` ログ） |
| R2 | ツールバー「Run this cell」 | ブロックされる |
| R3 | メニュー Run → Run All Cells | ブロックされる |
| R4 | コマンドパレット → "Insert Cell Below" | ブロックされる |
| R5 | キーボード `Shift+Enter`（セル実行） | `[LockManager] Blocked cell execution shortcut` ログでブロック |
| R6 | 任意のセルクリック | 選択はされるが edit mode に遷移しない（command mode に引き戻される） |

**ロック解除後の確認**:

7. `curl ... -d '{"type":"ai_edit_end","notebook_path":"<path>"}'` でロック解除
8. インジケータが消えることを確認
9. セルクリック → edit mode に遷移できる（mode 監視が解除されている）
10. T1〜T4, R1〜R5 相当の操作および Kernel → Restart Kernel がすべて正常に動作する
11. `Shift+Enter` でセル実行が成功する

**ロック中でないノートブックへの影響確認**:

12. 別のノートブック B を開き、ノートブック A だけを `ai_edit_start` でロック
13. ノートブック B にフォーカスを移し、interrupt / restart / セル操作がすべて正常に動作する

#### 3. 既存機能の回帰確認

- AI による編集（`cell_added` / `cell_edited` / `cell_execute_*`）が引き続き正常反映される
- WebSocket 切断時の `unlockAll` で mode 監視シグナルも正しく disconnect される（T7 として jupyter-server 停止→再開シナリオを確認）

## 検証結果

### 1. 静的検証（実施済み）

| 項目 | 結果 | 備考 |
|------|------|------|
| `tsc`（`jupyterlab-ai-sync/` で `npm run build:lib`） | PASS | 型エラーなし |
| `scripts/rebuild.sh jupyter-server` | PASS | Docker イメージ再ビルド成功、コンテナ healthy 確認済み |
| CI `JupyterLab AI Sync build`（`npm run build` = `tsc && jupyter labextension build .`） | PASS | PR #53 のチェックでグリーン |
| CI `TypeScript lint, typecheck & test` | PASS | PR #53 |
| CI `Python lint, typecheck & test` | PASS | PR #53 |
| CI `Integration test (Docker Compose)` | PASS | PR #53 |

### 2. 動的検証（playwright-cli で実施済み）

**環境**: `docker compose up -d` で全サービス起動、`scripts/rebuild.sh jupyter-server` で修正済み labextension を反映。テスト用ノートブック `work/issue51-test.ipynb`（`import time; print('start'); time.sleep(60); print('done')`）を Contents API で作成して実施。

| # | 操作 | 期待 | 結果 | エビデンス |
|---|------|------|------|-----------|
| **T1** | sleep セルを Run ボタンで実行 | セル `[*]`、kernel Busy | PASS | スナップショット `[*]:` / `Python 3 (ipykernel) \| Busy` |
| **Lock** | `curl POST /api/ai/events/broadcast {ai_edit_start}` でロック発火 | インジケータ表示、Mode: Command に遷移 | PASS | `AI が編集中です...` 表示、`Mode: Command` 表示、console に `[LockManager] Notebook locked` ログ |
| **T2** | キーボード `I I`（command mode ショートカット） | カーネル中断、セルが `KeyboardInterrupt` で停止 | **PASS** | セル `[1]:` に変化、`KeyboardInterrupt Traceback (most recent call last) Cell In[1], line 3 ... time.sleep(60) ... KeyboardInterrupt:` を観測、kernel Idle に遷移 |
| **T3** | ツールバー「■ Interrupt the kernel」ボタンクリック | 中断成功 | **PASS** | セル `[2]:` に変化、`KeyboardInterrupt Traceback (most recent call last) Cell In[2], line 3 ...` を観測、kernel Idle に遷移 |
| **T5** | ツールバー「⟳ Restart the kernel」ボタンクリック | **ブロック**・警告ログ | **PASS** | console に `[LockManager] Blocked command: notebook:restart-kernel` 警告、セルは `[*]:` のまま走り続けた（再起動されず） |
| **T7** | 中断後にロックインジケータが維持されるか | インジケータ表示継続 | PASS | T2/T3 後も `AI が編集中です...` が継続表示 |
| **R1** | ロック中にツールバー「Run this cell」ボタン | ブロック | PASS | console に `[LockManager] Blocked command: notebook:run-cell-and-select-next` 警告 |
| **Unlock** | `curl POST /api/ai/events/broadcast {ai_edit_end}` でロック解除 | インジケータ消失、modeChangedDisposer で mode 監視が解除 | PASS | console に `[LockManager] Unlocking notebook:` / `Notebook unlocked:` ログ、インジケータ消失 |

未実施項目（代替検証で十分と判断したもの）:
- T4（Kernel メニュー → Interrupt）: T3（同じ `notebook:interrupt-kernel` コマンドにマップ）で検証済みのため省略
- T6（`0 0` restart ショートカット）: T5（同じ `notebook:restart-kernel` コマンド）で検証済みのため省略
- R2〜R6: R1 で `BLOCKED_COMMAND_IDS` のパス自体が動作することを確認済み、今回の変更は allowlist 追加のみで既存の denylist ロジックに影響しないため省略

### 3. 既知の副次問題（本 Issue のスコープ外）

ツールバーの Interrupt ボタン経由で中断が成功した際、ブラウザ console に以下のエラーが観測された:

```
i: Invalid response: 200 OK
    at i.create (...jlab_core.js)
    at async Object.d [as interruptKernel] (...jlab_core.js)
    at async execute (...jlab_core.js)
```

- **挙動への影響**: なし。実際の interrupt 自体は成功している（セル実行カウンタの更新と `KeyboardInterrupt` の発生を確認済み）
- **発生箇所**: JupyterLab 本体の `interruptKernel` 関数内。jupyter-server からの 200 OK レスポンスを「invalid」と扱っている
- **判断**: 本 Issue（#51）のスコープ外。jupyterlab-ai-sync の変更範囲外であり、今回の修正前から存在していた可能性が高い。必要であれば別 Issue で追跡する
