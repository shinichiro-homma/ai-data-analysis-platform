# Jupyter（server + mcp + ai-sync）

コード実行、セッション管理、SQL、画像、AI同期に関する Phase。

---

## Phase 1: 基盤構築

### 1.1 jupyter-server 環境構築

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 1.1.1 | Dockerfile 作成 | [x] | - | ベースイメージ: jupyter/scipy-notebook |
| 1.1.2 | docker-compose.yml 作成 | [x] | - | |
| 1.1.3 | jupyter_server_config.py 作成 | [x] | - | トークン認証、CORS設定 |
| 1.1.4 | requirements.txt 作成 | [x] | - | pandas, matplotlib, pyarrow等 |
| 1.1.5 | ヘルスチェックスクリプト作成 | [x] | - | |
| 1.1.6 | 動作確認 | [x] | `docker-compose up` でJupyterLabにアクセス可能 | |
| 1.1.7 | matplotlib 日本語フォント自動設定 | [x] | matplotlibで日本語ラベルを含むグラフを描画し、文字化けなく画像が返る | kernel spec exec_lines で japanize-matplotlib を自動インポート |

### 1.2 jupyter-mcp プロジェクト初期化

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 1.2.1 | package.json, tsconfig.json 作成 | [x] | - | |
| 1.2.2 | jupyter-client 実装 | [x] | jupyter-server APIと疎通確認 | REST APIクライアント基盤 |

---

## Phase 2: ノートブック基本操作

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 2.1 | notebook_create ツール実装 | [x] | MCPツールでノートブックファイルが作成される | |
| 2.2 | notebook_add_cell ツール実装 | [x] | MCPツールでセルが追加される | |
| 2.3 | 結合テスト | [x] | ノートブック作成→セル追加の一連フローが動作 | |

---

## Phase 3: セッション・カーネル管理

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 3.1 | session_create ツール実装 | [x] | MCPツールでセッション（カーネル）が起動する | |
| 3.2 | session_list ツール実装 | [x] | MCPツールでセッション一覧が取得できる | |
| 3.3 | session_delete ツール実装 | [x] | MCPツールでセッションが終了する | |
| 3.4 | 結合テスト | [x] | セッション作成→一覧確認→削除の一連フローが動作 | |
| 3.5 | session_connect ツール実装 | [x] | ブラウザで開いたセッションにMCPで接続できる | ユーザー先行パターン |
| 3.6 | session_create のnotebook_path対応 | [x] | 指定したノートブックでセッション作成、ブラウザから接続可能 | AI先行パターン |

---

## Phase 4: コード実行

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 4.1 | execute_code ツール実装 | [x] | MCPツールで `print("hello")` を実行し結果が返る | |
| 4.2 | エラーハンドリング実装 | [x] | エラーコード実行時に適切なエラー情報が返る | 4.1に含めて実装済み |
| 4.3 | タイムアウト実装 | [x] | 長時間実行コードがタイムアウトする | 4.1に含めて実装済み |
| 4.4 | 結合テスト | [x] | ノートブック作成→セル追加→セッション作成→実行の一連フロー | |

---

## Phase 5: 変数管理

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 5.1 | get_variables ツール実装 | [x] | MCPツールで定義済み変数一覧が取得できる | |
| 5.2 | get_dataframe_info ツール実装 | [x] | MCPツールでDataFrameの詳細情報が取得できる | |
| 5.3 | 結合テスト | [x] | コード実行→変数確認の一連フロー | |

---

## Phase 6: ファイル操作

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 6.1 | file_list ツール実装 | [x] | MCPツールでワークスペース内ファイル一覧が取得できる | |
| 6.2 | 結合テスト | [x] | ノートブック作成→file_listで確認 | |

---

## Phase 7: 画像リソース

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 7.1 | execute_code の画像出力対応 | [x] | matplotlibグラフ実行時にimages配列が返る | Phase 10.1+10.2 で実装完了（ファイルベース） |
| 7.2 | get_image ツール実装 | [x] | get_image で file_path を指定し、MCP image content type で画像が取得できる | MCP image content type で返す方式 |
| 7.3 | 結合テスト | [x] | グラフ描画→画像保存→get_image で取得→image content type で返却の一連フロー | |

---

## Phase 8: AIリアルタイム同期

ブラウザで JupyterLab を開きながら、AI がノートブックを編集している様子をリアルタイムに表示する機能。AI 編集中はノートブックをロックし、ユーザーの入力を無効化する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 8.1 | セル追加のリアルタイム同期 | [x] | AIがnotebook_add_cellを呼ぶとブラウザ上のノートブックにセルが即座に追加される | WS基盤・JupyterLab拡張完了。Issue #1で拡張ロード問題を修正 |
| 8.2 | セル実行のリアルタイム同期 | [x] | AIがexecute_codeを呼ぶとブラウザ上にstdout/画像/エラーがリアルタイム表示される | jupyter-mcp側からbroadcastする方式（Option A）を採用。詳細は docs/tasks/jupyter/8.2 参照 |
| 8.3 | AI編集モード（自動ロック制御） | [ ] | ノートブック編集系ツール実行時に自動ロック→AI操作→自動アンロックの一連フローが動作する | handleToolCall ミドルウェアによる自動制御。MCPツールとしての ai_edit_start/ai_edit_end は廃止 |
| 8.4 | 統合テスト | [x] | ブラウザ上でAI操作（ロック→セル追加→実行→アンロック）がリアルタイムに反映される一連のフロー | AI同期イベント配信の統合テスト完成（11テスト成功） |
| 8.5 | ロック中のセル実行無効化 | [x] | ロック中にShift+Enter/Ctrl+Enterでセルが実行されない。アンロック後は正常に実行できる | capture フェーズの keydown リスナーで実行系ショートカットを消費 |

---

## Phase 9: SQL実行・データ取得機能

データカタログで確認したテーブル構造を基にSQLクエリを実行し、結果をワークスペースの `data/` ディレクトリにCSVとして保存する機能。AIがカタログ参照→SQL生成→データ取得→分析の一連フローを実行できるようにする。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 9.1 | jupyter-server: SQL実行API実装 | [x] | `POST /api/sql/execute` でSELECTクエリを実行し、結果CSVがワークスペースのdata/に保存される | DATABASE_URL接続、タイムアウト対応。DDL/DML/トランザクション系対応完了 |
| 9.2 | jupyter-mcp: execute_sql ツール実装 | [x] | MCPツールでSQLクエリを実行し、結果CSVがdata/に保存され、execute_codeで読み込める | 13テスト成功（execute-sql.test.ts）、セッション→ワークスペース解決。非SELECT対応完了 |
| 9.3 | カタログ参照→SQL実行→分析の結合テスト | [x] | document-mcpでカタログ参照→SQLクエリ生成→execute_sqlでデータ取得→execute_codeで分析の一連フローが動作する | E2Eシナリオ |
| 9.4 | execute_sql 複数SQL命令句対応 | [x] | DDL系（CREATE TEMP TABLE, DROP TABLE等）、DML系（INSERT INTO, UPDATE）、トランザクション系（BEGIN, COMMIT, ROLLBACK）が正常に実行され、DELETEは拒否される。非SELECT命令はCSV保存なしでaffected_rowsを返却する | jupyter-server バリデーション拡張 + jupyter-mcp テスト追加 |

---

## Phase 10: 画像ファイル永続化

画像をメモリ上の base64 ではなく、ワークスペースの `output/` ディレクトリにファイルとして永続化し、`execute_code` のレスポンスでは画像ファイルのパスのみを返す。これにより AI のコンテキストウィンドウの圧迫を仕組みとして回避する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 10.1 | jupyter-server 画像ファイル保存対応 | [x] | matplotlibグラフ実行時に output/ にPNGファイルが保存され、executeレスポンスの images に file_path が含まれる（base64データなし） | kernel_executor.py: display_data受信時にbase64デコード→ファイル保存→file_path返却 |
| 10.2 | jupyter-mcp ImageStore のファイルベース化 | [x] | execute_code MCPツールのレスポンスに file_path/mime_type/description が含まれ、base64データが一切含まれない | ImageStore→toImageReference関数化、uri-utils.ts削除、StoredImage型廃止。全ユニットテスト・型チェック通過 |
| 10.3 | 画像ファイル永続化の結合テスト | [x] | グラフ描画→output/にファイル保存確認→file_path返却確認→JupyterLab UIで画像表示確認の一連フロー | Phase 7 のテスト全面更新 |

---

## Phase 11: session_create ブラウザURL返却

session_create ツールの戻り値に `browser_url` を追加し、チャットクライアントからユーザーがJupyterLabのノートブックをブラウザで開けるようにする。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 11.1 | session_create ブラウザURL返却実装 | [x] | session_createの戻り値にbrowser_urlが含まれ、有効なJupyterLabのURLである | types.ts, session-create.ts, tools/index.ts の修正。notebook_path指定時はノートブックURL、未指定時はワークスペースディレクトリURL |

---

## Phase 12: SQLクエリ保存

execute_sql で実行したSQLクエリをワークスペースの `data/queries/` ディレクトリに `.sql` ファイルとして保存する機能。AIが実行したクエリや分析ロジックを後から確認・検証できるようにする。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 12.1 | execute_sql クエリ保存実装 | [x] | execute_sqlでSQLクエリを実行すると、`data/queries/{連番}_{filename}.sql` にクエリがメタデータ付きで保存され、レスポンスに `query_file_path` が含まれる | execute-sql.ts の修正、Jupyter Contents API 経由でファイル書き込み |
| 12.2 | クエリ保存の結合テスト | [x] | execute_sqlを複数回実行し、`file_list` で `data/queries/` 配下に連番の .sql ファイルが確認でき、各ファイルにメタデータとクエリ本文が含まれる | 単体テスト + 結合テスト |

---

## Phase 13: ファイルブラウザUI改善

JupyterLab のファイルブラウザの操作方法を改善する。シングルクリックでフォルダをツリー展開（インライン表示）、ダブルクリックでフォルダに移動（中身のみ表示）する。`jupyterlab-ai-sync` 拡張に `@jupyterlab/filebrowser` の `IFileBrowserFactory` を使ったカスタムロジックを追加して実現する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 13.1 | ファイルブラウザUI改善実装 | [x] | ブラウザでフォルダをシングルクリックするとツリー展開され、ダブルクリックするとフォルダに移動する | jupyterlab-ai-sync に file-browser-customizer.ts を追加。IFileBrowserFactory トークンを使用。F5.1: 展開状態は同一ディレクトリ内で保持、ディレクトリ変更時にリセット |
| 13.2 | ファイルブラウザUI改善の動作確認 | [x] | ワークスペース内のフォルダ階層をシングルクリックで展開・折りたたみ、ダブルクリックで移動できることをブラウザで目視確認する | 既存のファイル操作（ファイルのシングルクリック選択、ダブルクリック開く）に影響がないことも確認 |

---

## Phase 14: SQLデータエクスポート機能

SQLクエリ結果を大量行対応でワークスペースにファイル保存するツール。execute_sql（集計・確認用、max_rows制約あり、CSV出力）と補完する位置付けで、データセットの作成・保存に使用する。デフォルトはParquet形式、指定によりCSV形式で保存可能。ストリーミング処理（チャンク単位）でメモリ使用量を一定に抑える。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 14.1 | jupyter-server: SQL エクスポート API 実装 | [x] | `POST /api/sql/export` でSELECTクエリを実行し、結果がワークスペースの data/ にParquet/CSVとして保存される。チャンク処理（10,000行ずつ fetchmany → 書き出し）でメモリ効率化 | sql_handlers.py に SqlExportHandler 追加、pyarrow 依存追加 |
| 14.2 | jupyter-mcp: export_sql ツール実装 | [x] | MCPツールでSQLクエリ結果をParquet/CSVでエクスポートし、ワークスペースに保存。execute_codeで `pd.read_parquet('data/filename.parquet')` として読み込める。file_path, row_count, file_size_bytes を返却 | execute-sql.ts を参考に export-sql.ts 新規作成、client.ts に exportSql メソッド追加 |
| 14.3 | データエクスポートの結合テスト | [x] | カタログ参照→大量データSQLクエリ→export_sqlでParquet保存→execute_codeで読み込み→分析の一連フローが動作する | 大量行データでのメモリ効率化も確認 |

---

## Phase 15: アイドルカーネル自動停止

アイドル状態のカーネルを自動シャットダウンし、メモリ圧迫を防止する。Jupyter Server 標準の `MappingKernelManager.cull_*` 設定を利用。ブラウザ接続中・実行中・MCP操作直後のカーネルは保護される。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 15.1 | アイドルカーネル自動停止 | [x] | KERNEL_TIMEOUT=60 でカーネル作成後、約1〜2分で自動停止される | Jupyter 標準の cull 機能を利用。cull 時のカスタムAPI内部状態クリーンアップを含む |

---

## Phase 16: セル編集・削除・再実行

既存セルの内容を修正・削除し、特定セルを再実行できる機能。同じコードを何度もセル追加して実行する無駄を防ぎ、過去のコードを参照しながら分析を反復的に改善する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 16.1 | セル一覧取得・編集・削除 | [x] | notebook_list_cells でセル一覧取得。notebook_edit_cell でセル編集。notebook_delete_cell でセル削除後、後続セルのインデックスが正しく更新される | jupyter-server: GET /cells 新規、PATCH /cells の update/delete は実装済み。jupyter-mcp: 3ツール新規作成 |
| 16.2 | セル再実行 | [x] | notebook_execute_cell で指定セルを再実行し、出力と実行回数が更新される。リアルタイム同期でブラウザにも反映される | jupyter-server: POST /cells/{index}/execute 新規。jupyter-mcp: notebook_execute_cell 新規作成 |
| 16.3 | セル操作の結合テスト | [x] | セル追加→一覧取得→編集→再実行→削除の一連フローが動作する。AI編集モード中のリアルタイム同期も確認 | Phase 8（AI同期）との統合テスト |

---

## Phase 17: MCPツール追加（セル並び替え・データプレビュー・ファイル読み取り）

未実装のMCPツール3種を追加する。セル並び替え（F3.2一部）、データプレビュー（F4.3）、ファイル読み取り（F5.2、ノートブック以外）。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 17.1 | セル並び替え | [x] | notebook_reorder_cell でセルの位置を変更し、ノートブック内のセル順序が正しく更新される | jupyter-server: REST API追加、jupyter-mcp: MCPツール新規作成 |
| 17.2 | データプレビュー | [x] | data_preview でCSV/Parquetファイルの構造（カラム名・型・先頭行）を取得できる | jupyter-server: REST API追加、jupyter-mcp: MCPツール新規作成 |
| 17.3 | ファイル読み取り | [x] | file_read でテキストファイル（.sql, .py, .md等）の内容を取得できる。ノートブックは対象外 | jupyter-server: REST API追加、jupyter-mcp: MCPツール新規作成 |
| 17.4 | MCPツール追加の結合テスト | [x] | セル並び替え→データプレビュー→ファイル読み取りの各ツールがワークスペース内で正しく動作する | 統合テスト |

---

## Phase 18: カーネルクラッシュ自動復旧

カーネルプロセスが予期せずクラッシュした場合に自動的に新しいカーネルを起動し、セッションの連続性を維持する（NF3: 可用性）。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 18.1 | カーネルクラッシュ検出と自動復旧 | [x] | カーネルを意図的にクラッシュさせた後、自動的に新しいカーネルが起動しセッションが復旧する | jupyter-server: クラッシュ検出・自動再起動の実装 |
| 18.2 | カーネル自動復旧の結合テスト | [x] | MCP経由でコード実行中にカーネルクラッシュ→自動復旧→再実行が成功する | jupyter-mcp との統合テスト |
