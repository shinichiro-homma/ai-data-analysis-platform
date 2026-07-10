# Jupyter（server + mcp + ai-sync）

コード実行、セッション管理、SQL、画像、AI同期に関する Phase。

完了した Phase 1〜19 は [archive/01-jupyter.md](archive/01-jupyter.md) を参照。

---

## Phase 20: 実行制御の環境変数化とカーネル上限

要件定義済みだが未実装の実行制御機能。詳細は `docs/requirements/jupyter-server.md` を参照。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 20.1 | 環境変数 `EXECUTION_TIMEOUT` 対応 | [ ] | `EXECUTION_TIMEOUT=10` で起動し、10秒超のコード実行がタイムアウトする | 現在はAPIパラメータのデフォルト30秒をハードコード |
| 20.2 | 環境変数 `MAX_OUTPUT_SIZE` 対応 | [ ] | `MAX_OUTPUT_SIZE` を小さく設定し、超過する出力が切り詰められる | NF1で1MB/実行と定義 |
| 20.3 | 同時カーネル上限の強制 | [ ] | 上限（5カーネル）到達後の session_create がエラーになる | F1.1で定義、未実装 |

## Phase 21: AI リアルタイム同期の再設計（ADR-0002）

[ADR-0002](../adr/0002-ai-sync-notify-reload.md) に基づき、差分同期を廃止して「ディスク上の .ipynb を唯一の真実とし、変更通知 + ブラウザ側再読込で同期する」方式へ移行する。不変条件 I1/I2/I5（`docs/design/invariants.md`）の既知違反の解消が目的。実装順は 21.1 → 21.2 → 21.3 → 21.4 → 21.5（各タスクが次の前提）。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 21.1 | ノートブック編集ツール宣言の型化 | [ ] | `mutatesNotebook` 未宣言のツール登録が型チェックで失敗し、レジストリ走査テストが既知の編集ツール12個の宣言を検証する | `NOTEBOOK_EDIT_TOOLS` Set の廃止。21.2 のミドルウェア変更の前提 |
| 21.2 | ノートブックロックのサーバー側強制 | [ ] | AI 編集ツール実行中に別クライアントからのセル操作 API・ブラウザ保存が 423 で拒否される。MCP がロック解放に失敗しても TTL 失効後に編集が可能に戻る（異常系） | ロックストア + ロック API + lock_acquired/released 通知。`ai_edit_start/end` 廃止 |
| 21.3 | 変更通知 + 再読込の完全同期 | [ ] | AI がセルを追加するとブラウザのノートブックに反映される。ブラウザが対象ノートブックを開いていなくても実行出力がファイルに保存される（Issue #76 の異常系） | 差分イベント12種を廃止し `notebook_changed`（seq 付き）へ。ブラウザは `context.revert()` |
| 21.4 | 再接続時の再同期 | [ ] | WebSocket 切断中に AI がセルを追加しても、再接続後にブラウザ表示が実ファイルと一致する（異常系） | 状態照会 API + seq ギャップ検出 + ロック状態再適用 |
| 21.5 | 同期再設計の統合テストとドキュメント整合 | [ ] | ロック強制・通知再読込・再接続再同期の統合テストが `scripts/test.sh jupyter-mcp --integration` で成功する | 要件定義・API 契約の総点検を含む |

## Phase 23: jupyter-server 堅牢化

不変条件 I3/I6/I7 の既知違反を解消し、handlers.py モノリスを分割する。実装順は 23.1 → 23.2 → 23.3 → 23.4 → 23.5（23.1 のカーネルロックが 23.2 の前提、23.3 の分割が 23.4/23.5 の前提）。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 23.1 | カーネル単位の実行直列化ロック | [x] | 同一カーネルに2つの execute を並行送信し、各レスポンスの出力が混線せず正しい結果を返す（異常系: ロック待ちタイムアウト） | kernel_executor.py に asyncio.Lock 辞書を導入。I6 解消 |
| 23.2 | async ハンドラ内の同期 I/O オフロード | [x] | 大きな CSV（10万行）のプレビューが他リクエストをブロックせず完了する（異常系: ファイル不在時のエラー応答） | handlers.py preview / workspace_handlers.py を run_in_executor 化。I3 解消 |
| 23.3 | handlers.py の分割 | [x] | `scripts/test.sh jupyter-server` が分割前後で全パス。handlers.py が 500 行以下になる | kernel/cell_actions/contents/preview の4モジュールに分割 |
| 23.4 | SQL コネクションプール化 | [x] | SQL 実行が共有プールを使い、リクエスト間で接続が再利用される（異常系: DB 接続不能時に明確なエラー） | アプリ起動時に1回だけ engine 生成。sql_handlers.py 改修 |
| 23.5 | sandbox の os.rename/os.replace ブロック追加 | [x] | カーネル内で `os.rename('/other_ws/file', 'local')` を実行すると PermissionError になる | workspace_sandbox.py + code_validator.py にパッチ追加。shutil は import 段階でブロック済み |
