# Issue #51: AI編集ロック中にカーネル中断が効かない（要件 F3.3 通りに動作していない）

## 関連タスク

- タスク番号: 8.3 / 8.5（`docs/plan/01-jupyter.md` — AI 編集モード・ロック中のセル実行無効化）
- 要件: `docs/requirements/jupyterlab-ai-sync.md` F3.3 / AC6

## ステータス

- [x] 起票
- [ ] 原因特定
- [ ] 修正方針レビュー完了
- [ ] 修正完了

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
