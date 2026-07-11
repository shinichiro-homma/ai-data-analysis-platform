# jupyter-mcp 要件定義

## 概要

生成AIがJupyter環境を操作するためのMCPサーバー。jupyter-serverのREST APIをラップし、MCPツールとして提供する。

> **入出力スキーマ・パラメータ・デフォルト値・上限値・エラーの詳細は `jupyter-mcp/src/tools/*.ts` の zod スキーマとツール定義が正（Single Source of Truth）**。本ドキュメントは機能要件（Why・受け入れ条件）とツール一覧のみを扱い、実装詳細は転記しない。

## 機能要件

### F1: セッション管理

#### F1.1: セッション作成
- 新しい分析セッションを作成できる
- セッション作成時にカーネルが自動起動する
- セッションIDを返却する
- ワークスペースIDを指定することで、そのワークスペース内にセッションを作成できる
- カーネルの作業ディレクトリはワークスペースのディレクトリに設定される
- 戻り値にJupyterLabのブラウザURL（`browser_url`）を含め、チャットクライアントからユーザーがノートブックを開けるようにする

#### F1.2: セッション終了
- 指定セッションを終了できる
- 関連するカーネル・ノートブックをクリーンアップする

#### F1.3: セッション一覧
- アクティブなセッション一覧を取得できる
- 各セッションの状態（idle/busy）を確認できる

#### F1.4: 既存セッションへの接続
- 既存のノートブックに紐づくセッション一覧を取得できる
- 指定したセッション/カーネルに接続できる
- ブラウザのJupyterLabと同じカーネルを共有できる

#### F1.5: ノートブック指定でのセッション作成
- ノートブックパスを指定してセッションを作成できる
- ユーザーが後からそのノートブックを開くと同じカーネルを使用する
- ワークスペース内の相対パスで指定する（例: `analysis.ipynb`）

### F2: コード実行

#### F2.1: コード実行（同期）
- Pythonコードを実行し、結果を返却する
- シェルコマンド実行を含むコード（IPython シェルマジック `!`、`subprocess`、`os.system`、`ctypes` 等）は jupyter-server の AST 検査 + sandbox でブロックされる（NF2.1 参照）
- 実行結果には以下を含む:
  - stdout/stderr
  - 戻り値（表示可能な形式）
  - 画像出力（参照情報のみ、base64データは含めない）
  - 実行時間

#### F2.2: コード実行（セル単位）
- ノートブックの特定セルを実行できる
- セルインデックスまたはセルIDで指定

### F3: ノートブック操作

#### F3.1: ノートブック作成
- 新規ノートブックを作成
- オプションで初期セルを設定可能
- ワークスペースが指定されている場合、ワークスペースディレクトリ内に作成する
- 同名のファイルが既に存在する場合、サーバー側の自動連番により別名で作成される
- 戻り値には実際に作成されたノートブックのパス、ワークスペースID、作成日時を含む

#### F3.2: セル操作
- セルの追加（code/markdown）
- セルの一覧取得（ソース・出力・実行回数を含む）
- セルの編集（既存セルのソースコードを更新）
- セルの削除
- セルの再実行（指定セルのコードをカーネルで実行し、出力を更新）
- セルの並び替え
- セルの一括実行（全セル / ここまで / これ以降）
- セルの結合（複数セルを1つに結合）
- セルの分割（1つのセルを指定行で分割）
- セルのタイプ変更（code ↔ markdown）
- セルのコピー（指定位置にセルを複製）
- セルの出力クリア（単一セル / 全セル）

#### F3.3: カーネル制御
- カーネル再起動（変数・実行状態をリセット）
- カーネル再起動+全セル実行（再起動後にノートブックの全コードセルを順番に実行）
- カーネル中断はユーザーが JupyterLab UI から行う（kernel_interrupt MCPツールは提供しない。MCP はリクエスト-レスポンス型のため、AI が実行待機中に別ツールを呼べない）
  - カーネル実行を伴うツール（execute_code, notebook_execute_cell, notebook_execute_batch）が KeyboardInterrupt を受けた場合、エラー種別として `KeyboardInterrupt` を MCP レスポンスに含める

### F4: 変数・データ操作

#### F4.1: 変数一覧
- カーネル内の変数一覧を取得
- 変数名、型、サイズ（概算）を返却

#### F4.2: 変数詳細取得
- 指定変数の値を取得
- DataFrame の場合は特別な形式で返却:
  - shape, columns, dtypes
  - head（先頭N行）
  - describe（統計情報）
  - memory_bytes（メモリ使用量）

#### F4.3: データプレビュー
- ファイルパスを指定してデータをプレビュー
- CSV, Excel, Parquet等に対応

### F5: ファイル操作

#### F5.1: ファイル一覧
- 指定ワークスペース内のファイル一覧を取得
- ワークスペースIDでスコープされ、他のワークスペースのファイルは表示されない

#### F5.2: ファイル読み取り
- テキストファイルの内容を取得（ノートブック以外。ノートブックは notebook_list_cells で構造化された形式で取得する）

### F6: AI編集制御

#### F6.1: ノートブックロックの取得・解放
- ノートブックを変更するツール（各ツールが `mutatesNotebook: true` を宣言）の実行時に、`handleToolCall` ミドルウェアがサーバー側ロック API でロックを取得し、ツール実行後に解放する
- ロック取得が競合（HTTP 423）した場合はツールを実行せず `NOTEBOOK_LOCKED` エラーを返す
- 実行中は定期的にロックを延長（heartbeat）してサーバー TTL の失効を防ぐ。ロック解放の失敗はログ警告のみとし、サーバー側 TTL 失効に委ねる（イベント配信の成否に依存しない）
- 対象ツールはツール登録時に必須フィールド `mutatesNotebook` で宣言する（宣言漏れは型チェックで検知される）。`handleToolCall` ミドルウェアはこの宣言からロック対象を導出するため、新しいノートブック操作ツール追加時は `mutatesNotebook: true` を宣言するだけで自動対応される
- ロック取得・解放・延長は独立した MCP ツールとしては提供しない（内部自動処理のみ）
- カーネル中断は MCP ツールとしては提供しない（ユーザーが JupyterLab UI から直接実行する）

#### F6.3: AI操作のリアルタイム同期
- ノートブックへの変更（セル追加・編集・削除・出力永続化等）は書き込み系 API が自動で `notebook_changed`（seq 付き）を配信する
- `execute_code` 実行時、jupyter-mcp が `POST /api/ai/events/broadcast` を通じて ephemeral 通知（`cell_execute_start` / `cell_execute_end`）を配信する
- ブラウザは `notebook_changed` 受信時にディスク再読込（`context.revert()`）でノートブックを同期する
- JupyterLab上のノートブックUIにAIの操作がリアルタイムに反映される

### F7: 画像出力

#### F7.1: 実行結果の画像参照
- コード実行で生成された画像の参照情報（ファイルパス、MIME type、説明）を `execute_code` のレスポンスに含める
- matplotlib, seaborn, plotly等の出力に対応
- 画像はワークスペースの `output/` ディレクトリにファイルとして保存する（jupyter-server 側で保存）
- AIへのレスポンスにはファイルパスのみを含め、base64データは一切含めない（パス形式は `jupyter-server/app/routers/kernel.py` を参照）
- AIが画像を視覚的に確認したい場合は `get_image` ツールを使用する（MCP image content type で返却）

#### F7.2: 画像ファイルの永続化
- コード実行で生成された画像をワークスペースの `output/` にファイルとして永続化する
- 各画像にはユニークなファイル名を付与（ファイル名規則は `jupyter-server/app/routers/kernel.py` を参照）
- ファイルパスは `workspaces/{workspace_id}/output/` 配下で管理
- JupyterLab UI および `file_list` ツールから画像ファイルにアクセス可能

#### F7.3: get_image ツールによる画像取得
- `execute_code` のレスポンスに含まれる `file_path` を指定して、画像データを MCP の image content type で取得できる
- AIクライアント（Claude Desktop等）がビジョン機能で画像を分析したい場合に使用する
- Jupyter Contents API 経由でファイルを取得し、MCP の image content type で返す
- テキストレスポンス（`type: "text"`）に base64 データを含めない（コンテキストウィンドウ節約の方針を維持）
- `execute_code` のテキストレスポンスには引き続き `file_path` のみを含める

### F8: ワークスペース管理

チャット（AI会話セッション）ごとに独立した作業空間を提供する。ワークスペースはファイルシステム上のディレクトリとして永続化され、MCP再起動後も利用可能。

#### F8.1: ワークスペース作成
- 新しいワークスペース（独立した作業空間）を作成できる
- ワークスペースはファイルシステム上のサブディレクトリとして作成される
- ワークスペースIDと名前を返却する
- 同一名でも別のワークスペースとして作成される（IDで一意に識別）
- ワークスペース作成時に `data/` と `output/` サブディレクトリが自動作成される
  - `data/`: 分析用入力データの配置場所
  - `output/`: 分析結果の出力先
- オプションで `summary`（作業内容の概要）と `status`（ステータス）を指定できる

#### F8.2: ワークスペース一覧
- 既存のワークスペース一覧を取得できる
- 各ワークスペースの名前、作成日時、ファイル数、サマリ、ステータスを返却する
- MCP再起動後も、ディスク上に存在するワークスペースを列挙できる

#### F8.4: ワークスペースメタデータ更新
- 既存ワークスペースの `summary` と `status` を更新できる
- `summary` は作業内容の概要
- `status` は許可された値のいずれかを指定する

#### F8.5: ワークスペースサマリ生成
- ワークスペースの作業内容に基づいて検証レポートを生成するためのテンプレートと評価基準を取得する
- ユーザーから明示的にサマリ作成を依頼された場合のみ使用する
- レスポンスに含まれるテンプレートに従ってレポートを生成し、SUMMARY.md としてワークスペースに保存する
- テンプレートと評価基準はツール定義（description）には含めず、ツール実行時にサーバーから返却される

#### F8.3: ワークスペースの永続性
- ワークスペースのディレクトリとその中のファイル（ノートブック等）はディスク上に永続化される
- MCP/クライアント再起動後も `workspace_list` で既存ワークスペースを発見でき、`session_create` で新規セッションを紐付けられる
- カーネル（セッション）はアイドルタイムアウト後に停止するが、ファイルは保持される

### F9: SQL実行・データ取得

#### F9.1: SQLクエリ実行
- SQLクエリを実行し、SELECT文の場合は結果をワークスペースの `data/` ディレクトリにCSVファイルとして保存できる
- jupyter-serverの `POST /api/sql/execute` を呼び出して実行する
- セッションIDからワークスペースを特定し、保存先を自動決定する
- 危険なSQL命令句をブラックリスト方式で**拒否**する（jupyter-server側で判定）。ブロック対象・許可条件の詳細は `jupyter-server/extensions/custom_api/sql_handlers.py` の `BLOCKED_COMMANDS` および `_classify_sql()` を参照
- 非SELECT命令は結果セットを返さないため、CSV保存は行わない（affected_rows を返却）

#### F9.2: 実行制御
- タイムアウト設定が可能
- 結果行数の上限を設定可能

#### F9.3: 実行クエリの保存
- execute_sql で実行したSQLクエリを、ワークスペースの `data/queries/` ディレクトリに `.sql` ファイルとして保存する
- ファイル形式はプレーンテキスト（.sql）で、ヘッダーにメタデータをSQLコメントとして記載する
- ファイル名は `{連番}_{CSVファイル名}.sql` 形式（例: `001_transactions.sql`）
- メタデータとして実行日時、結果CSVファイル名、取得行数、実行時間を記録する
- 保存は実行成功時のみ行う（バリデーションエラーやSQL実行エラー時は保存しない）
- AIが実行したクエリや分析ロジックを後から確認・検証できるようにする

### F11: SQLデータエクスポート

#### F11.1: 大規模データのファイルエクスポート
- SQLクエリの結果をワークスペースの `data/` ディレクトリにファイルとして直接書き出す
- execute_sql が集計・確認用（max_rows制約あり、結果をテキストで返す）であるのに対し、export_sql はデータセット作成・保存用
- 行数制限なし、ストリーミング処理（チャンク単位で fetchmany → 書き出し、チャンクサイズは `jupyter-server/app/routers/sql.py` を参照）でメモリ使用量を一定に抑える
- デフォルトの出力形式は Parquet。ユーザーから指示があった場合のみ CSV で保存可能
- jupyter-server の `POST /api/sql/export` を呼び出して実行する
- セッションIDからワークスペースを特定し、保存先を自動決定する
- execute_sql と同様に、危険なSQL命令句はブラックリスト方式で拒否される（jupyter-server側で判定）

#### F11.2: エクスポート実行制御
- タイムアウト設定が可能
- SELECT文のみエクスポート対象（非SELECT文はバリデーションエラー）

#### F11.3: 実行クエリの保存
- エクスポート成功時に、実行したSQLクエリを `data/queries/{連番}_{filename}.sql` としてワークスペースに保存する
- execute_sql の F9.3 と同じ共通ユーティリティ（`saveQueryFile`）を使用する
- レスポンスに `query_file_path` を含める

### F10: 外部データアップロード 【未実装】

ステータス: 未実装（対応する MCP ツールは未登録）。

#### F10.1: 外部データのアップロード
- チャットから提供されたファイル（CSV、Excel等）をワークスペースの `data/` ディレクトリにアップロードできる
- ホスト側のファイルパス（source_path）を受け取り、MCPサーバーが直接読み取ってアップロードする
- ファイル名を指定してワークスペース内に保存する
- 保存後、ファイルパス・ファイルサイズを返却する
- カタログで `data_source.type: external` として定義されているデータを、分析時に提供する際に使用する

## ツール一覧

`jupyter-mcp/src/tools/index.ts` の `registerTools()`（`toolRegistry`）で登録されている全ツール。各ツールの description・入出力スキーマは同ファイルおよび `src/tools/*.ts` が正（CI がこの表とコードを機械照合する）。

| ツール | F番号 | 目的 |
|--------|-------|------|
| `workspace_create` | F8.1 | ワークスペース（チャット独立の作業空間）を作成する |
| `workspace_update` | F8.4 | ワークスペースのメタデータ（summary/status）を更新する |
| `workspace_list` | F8.2 | 既存のワークスペース一覧を取得する |
| `workspace_summarize` | F8.5 | ワークスペースの検証レポート用テンプレート・評価基準を取得する |
| `notebook_create` | F3.1 | 新規ノートブックをワークスペース内に作成する |
| `notebook_add_cell` | F3.2 | ノートブックにセル（code/markdown）を追加する |
| `notebook_list_cells` | F3.2 | ノートブックの全セル一覧（ソース・出力・実行回数）を取得する |
| `notebook_edit_cell` | F3.2 | 既存セルのソースコードを編集する |
| `notebook_delete_cell` | F3.2 | 指定セルを削除する |
| `notebook_reorder_cell` | F3.2 | セルを別の位置に移動する |
| `notebook_execute_cell` | F2.2, F3.2 | 指定セルをカーネルで再実行し出力を更新する |
| `notebook_execute_batch` | F3.2 | セルを一括実行する（全セル / ここまで / これ以降） |
| `session_create` | F1.1, F1.5 | 分析セッション（カーネル）を作成する |
| `session_list` | F1.3 | アクティブなセッション一覧を取得する |
| `session_delete` | F1.2 | セッションを終了しリソースを解放する |
| `session_connect` | F1.4 | 既存セッション/カーネルに接続する |
| `execute_code` | F2.1, F7.1 | Pythonコードを実行し結果と画像参照を返す |
| `get_variables` | F4.1 | セッション内の変数一覧を取得する |
| `get_dataframe_info` | F4.2 | DataFrameの詳細情報（shape/columns/head/統計）を取得する |
| `file_list` | F5.1 | ワークスペース内のファイル一覧を取得する |
| `execute_sql` | F9.1, F9.2, F9.3 | SQLを実行しSELECT結果をCSV保存する |
| `export_sql` | F11.1, F11.2, F11.3 | SQL結果を大規模データセットとして Parquet/CSV でエクスポートする |
| `get_image` | F7.3 | 生成画像を MCP image content type で取得する |
| `data_preview` | F4.3 | ワークスペース内のデータファイル（CSV/Parquet）をプレビューする |
| `file_read` | F5.2 | ワークスペース内のテキストファイルの内容を取得する |
| `notebook_merge_cells` | F3.2 | 隣接する複数セルを1つに結合する |
| `notebook_split_cell` | F3.2 | セルを指定行で2つに分割する |
| `notebook_change_cell_type` | F3.2 | セルのタイプを変更する（code ↔ markdown） |
| `notebook_copy_cell` | F3.2 | セルを指定位置にコピー（複製）する |
| `notebook_clear_outputs` | F3.2 | セルの出力をクリアする（単一セル / 全セル） |
| `kernel_restart` | F3.3 | カーネルを再起動し変数・実行状態をリセットする |

> ノートブックロックの取得・解放（F6.1）とカーネル中断は独立した MCP ツールとしては提供しない（前者は `handleToolCall` の内部自動処理、後者はユーザーが JupyterLab UI から実行）。

## 非機能要件

### NF1: パフォーマンス

| 項目 | 要件 |
|------|------|
| MCPツール応答時間 | jupyter-server応答 + 100ms以内 |
| 同時セッション数 | 最大10 |
| 最大レスポンスサイズ | 1MB |

### NF2: エラーハンドリング

- jupyter-serverへの接続エラーを適切にハンドリング
- タイムアウト時は明確なエラーメッセージを返却
- カーネルクラッシュ時は自動復旧を試みる

### NF3: ログ

- 全ツール呼び出しの開始・完了・エラーをログ出力する
- ログレベル: 呼び出し開始・完了は `info`、エラーは `error`
- ログに含める情報: ツール名、主要パラメータ、実行時間
- 実行コードは機密情報を含む可能性があるため、デフォルトでログに含めない
- ログ出力先: stderr（MCP SDKの標準）
- **実装方針:** MCP SDK の標準ログ機構を使用。環境変数 `LOG_LEVEL` でログレベルを制御

## 技術仕様

### 技術スタック

- TypeScript
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- axios または fetch（HTTP クライアント）

### 環境変数

> **正（SSoT）**: 環境変数の定義は各コンポーネントの `CLAUDE.md` を参照。ここでは要件としての説明のみ記載。

デフォルト値は `jupyter-mcp/CLAUDE.md` を参照。

| 変数名 | 説明 |
|--------|------|
| `JUPYTER_SERVER_URL` | jupyter-serverのURL |
| `JUPYTER_TOKEN` | jupyter-server認証トークン |
| `MCP_PORT` | MCPサーバーポート |
| `LOG_LEVEL` | ログレベル |

### 起動コマンド

```bash
# 開発
npm run dev

# 本番
npm run build && npm start
```

## 受け入れ条件

### AC1: セッション管理
- [ ] session_create でセッションが作成される
- [ ] session_create の戻り値に `browser_url` が含まれる
- [ ] `browser_url` は有効なJupyterLabのURLである（notebook_path指定時はノートブックURL、未指定時はワークスペースディレクトリURL）
- [ ] session_list で作成したセッションが表示される
- [ ] session_delete でセッションが削除される

### AC2: コード実行
- [ ] execute_code で `print("hello")` を実行し、stdoutに"hello"が返る
- [ ] execute_code でエラーを起こすコードを実行し、エラー情報が返る
- [ ] execute_code でmatplotlibグラフを作成し、画像が返る
- [ ] タイムアウト設定が機能する
- [ ] execute_code で `!ls` を実行するとエラーが返る（シェルコマンドブロック）
- [ ] execute_code で `import subprocess; subprocess.run(['ls'])` を実行するとエラーが返る（シェルコマンドブロック）

### AC3: 変数操作
- [ ] get_variables で定義済み変数一覧が取得できる
- [ ] get_dataframe_info でDataFrameの詳細が取得できる
- [ ] get_dataframe_info の戻り値に memory_bytes（メモリ使用量）が含まれる

### AC4: ノートブック操作
- [ ] notebook_create でノートブックが作成される
- [ ] notebook_create で同名ファイルが存在する場合、自動連番（`_2`, `_3`, ...）で作成される
- [ ] 自動連番で作成された場合、戻り値に実際のファイルパスが含まれる
- [ ] notebook_add_cell でセルが追加される
- [ ] notebook_list_cells でセル一覧が取得でき、各セルのソース・出力・実行回数が含まれる
- [ ] notebook_edit_cell で既存セルのソースコードが更新される
- [ ] notebook_delete_cell でセルが削除され、後続セルのインデックスが正しく更新される
- [ ] notebook_execute_cell で指定セルがカーネルで再実行され、出力と実行回数が更新される
- [ ] 範囲外のセルインデックスを指定した場合にエラーが返る

### AC5: 画像参照
- [ ] matplotlibでグラフを描画すると、execute_codeの結果にImageReference（file_path, mime_type, description）が含まれる
- [ ] file_path が `workspaces/{workspace_id}/output/` 配下のパスであること
- [ ] 画像ファイルがワークスペースの `output/` ディレクトリに保存されている
- [ ] 画像の実データはJupyterLab UIで確認できる
- [ ] execute_code のレスポンスにbase64データが含まれない（file_pathのみ）
- [ ] ノートブック変更通知（notebook_changed）によりブラウザがディスク再読込し、JupyterLab上で画像が表示される
- [ ] get_image で execute_code のレスポンスの file_path を指定し、MCP image content type で画像データが取得できる
- [ ] get_image で存在しないパスを指定した場合、適切なエラーが返される

### AC6: MCPプロトコル
- [ ] MCP Inspector で全ツールが表示される
- [ ] Claude Desktop から接続して操作できる

### AC7: カーネル共有
- [ ] ブラウザでノートブックを開き、session_connectで接続すると同じ変数空間を共有できる
- [ ] session_create(notebook_path=...)で作成したセッションに、ブラウザから接続できる
- [ ] 共有セッションでAIがコードを実行すると、ブラウザ側のノートブックに反映される

### AC8: ノートブックロック制御
- [ ] ノートブック編集系ツール（execute_code, notebook_add_cell 等）を実行すると、サーバー側でノートブックがロックされる
- [ ] ツール実行完了後、ロックが解除される
- [ ] ロック中に他の操作が同一ノートブックへ書き込もうとすると 423（`NOTEBOOK_LOCKED`）で拒否される
- [ ] ロック中にブラウザ上のセルに実行結果がリアルタイムに表示される
- [ ] ロック取得が競合した場合はツールを実行せず `NOTEBOOK_LOCKED` エラーを返す
- [ ] 新しいノートブック操作ツールに `mutatesNotebook: true` を宣言するだけでロック制御が適用される

### AC13: セル一括操作
- [ ] notebook_execute_batch (mode: all) で全コードセルが順番に実行される
- [ ] notebook_execute_batch (mode: up_to) で指定セルまでが実行される
- [ ] notebook_execute_batch (mode: from) で指定セル以降が実行される
- [ ] notebook_merge_cells で複数セルが1つに結合される
- [ ] notebook_split_cell でセルが2つに分割される
- [ ] notebook_change_cell_type でセルタイプが変更される
- [ ] notebook_copy_cell でセルが複製される
- [ ] notebook_clear_outputs (cell_index指定) で単一セルの出力がクリアされる
- [ ] notebook_clear_outputs (cell_index省略) で全セルの出力がクリアされる

### AC14: カーネル制御
- [ ] kernel_restart でカーネルが再起動され、変数がリセットされる
- [ ] kernel_restart → notebook_execute_batch(mode: 'all') の順次呼び出しで再起動後に全セルが実行される
- [ ] カーネル実行を伴うツール（execute_code, notebook_execute_cell, notebook_execute_batch）が KeyboardInterrupt を受けた場合、エラー種別 `KeyboardInterrupt` が MCP レスポンスに含まれる

### AC10: SQL実行・データ取得
- [x] execute_sql でSELECTクエリを実行し、結果がワークスペースの `data/` にCSVファイルとして保存される
- [x] 保存されたCSVファイルを execute_code で `pd.read_csv('data/filename.csv')` として読み込める
- [x] レスポンスに行数・カラム一覧・ファイルパス・ファイルサイズが含まれる
- [x] DDL系（CREATE TEMP TABLE, DROP TABLE等）、DML系（INSERT INTO, UPDATE）、トランザクション系（BEGIN, COMMIT, ROLLBACK）のクエリが正常に実行される
- [x] DELETE文を実行しようとするとエラーが返る
- [ ] ALTER, GRANT, REVOKE, VACUUM, ANALYZE, CREATE TABLE（非TEMP）, CREATE INDEX, DROP INDEX を実行しようとするとエラーが返る
- [ ] 非SELECT命令の実行時にCSV保存が行われず、affected_rows を含むレスポンスが返る
- [x] タイムアウト設定が機能する
- [x] データベース接続エラー時に適切なエラーメッセージが返る
- [ ] execute_sql 実行成功時に、SQLクエリが `data/queries/{連番}_{filename}.sql` に保存される
- [ ] 保存された `.sql` ファイルにメタデータ（実行日時、結果ファイル名、行数、実行時間）がSQLコメントとして含まれる
- [ ] レスポンスに `query_file_path` が含まれる
- [ ] バリデーションエラーやSQL実行エラー時にはクエリファイルが保存されない
- [ ] `file_list` で `data/queries/` 配下のクエリファイルが確認できる

### AC12: SQLデータエクスポート
- [ ] export_sql でSELECTクエリを実行し、結果がワークスペースの `data/` にParquetファイルとして保存される
- [ ] format 未指定時にデフォルトで Parquet 形式で出力される
- [ ] format: "csv" 指定時に CSV 形式で出力される
- [ ] 保存されたParquetファイルを execute_code で `pd.read_parquet('data/filename.parquet')` として読み込める
- [ ] レスポンスに file_path, row_count, file_size_bytes, format, execution_time_ms が含まれる
- [ ] 大量行（100万行以上）のデータがメモリ枯渇なくエクスポートされる
- [ ] 非SELECT文（INSERT, CREATE等）を指定するとバリデーションエラーが返る
- [ ] タイムアウト設定が機能する
- [ ] データベース接続エラー時に適切なエラーメッセージが返る
- [ ] エクスポート成功時に実行クエリが `data/queries/` に `.sql` ファイルとして保存される
- [ ] レスポンスに `query_file_path` が含まれる

### AC9: ワークスペース分離
- [ ] workspace_create でワークスペースが作成される
- [ ] workspace_create で `summary` と `status` を指定した場合、戻り値に含まれる
- [ ] workspace_list で作成済みワークスペース一覧が取得でき、各ワークスペースに `summary` と `status` が含まれる
- [ ] workspace_update で `summary` と `status` を更新できる
- [ ] workspace_update で存在しない workspace_id を指定するとエラーが返る
- [ ] workspace_summarize でテンプレートと評価基準が返却される
- [ ] workspace_summarize のレスポンスに `template`、`verification_criteria`、`instructions` が含まれる
- [ ] ワークスペースAで作成したノートブックが、ワークスペースBの file_list に表示されない
- [ ] session_create(workspace_id=...) でカーネルの作業ディレクトリがワークスペースに設定される
- [ ] MCP再起動後も workspace_list で既存ワークスペースが取得できる
- [ ] MCP再起動後も既存ワークスペース内のファイルにアクセスできる
- [ ] workspace_create で `data/` と `output/` サブディレクトリが自動作成される
- [ ] workspace_create の戻り値に `data_path` と `output_path` が含まれる
- [ ] カーネル内で `data/input.csv` や `output/result.csv` にアクセスできる
- [ ] ワークスペースAのセッションからワークスペースBのファイルにアクセスできない（execute_code経由）

## 依存関係

- jupyter-server が起動していること

## AIエージェント向けの使用ガイドライン

このMCPサーバーを使用するAIエージェントは、以下のパターンでツールを使用することを推奨:

### 基本的な分析フロー（DB連携）

```
1. workspace_create でワークスペースを作成（または workspace_list で既存を選択）
2. session_create(workspace_id=...) でセッションを作成
3. document-mcp でデータカタログを参照し、テーブル構造を理解
4. データセット作成: export_sql でSQLクエリを実行し、データをdata/にParquetとして保存
   集計・確認: execute_sql でSQLクエリを実行し、結果をdata/にCSVとして保存
5. execute_code で pd.read_parquet('data/filename.parquet') または pd.read_csv('data/filename.csv') でデータ読み込み
6. get_variables / get_dataframe_info でデータ構造を確認
7. execute_code で分析コードを実行
8. 必要に応じて notebook_add_cell で記録
9. 分析完了後、session_delete でクリーンアップ
```

### 基本的な分析フロー（コード内データ読み込み）

```
1. workspace_create でワークスペースを作成（または workspace_list で既存を選択）
2. session_create(workspace_id=...) でセッションを作成
3. execute_code でデータ読み込み
4. get_variables / get_dataframe_info でデータ構造を確認
5. execute_code で分析コードを実行
6. 必要に応じて notebook_add_cell で記録
7. 分析完了後、session_delete でクリーンアップ
```

### 可視化を含むフロー

```
1. workspace_create でワークスペースを作成（または workspace_list で既存を選択）
2. session_create(workspace_id=...) でセッションを作成
3. execute_code でデータ読み込み・可視化コード実行
3. レスポンスの images 配列から画像生成の有無・枚数・説明・保存先（file_path）を確認
4. 画像の詳細はユーザーがJupyterLab UIで確認（output/ ディレクトリに保存済み）
5. 具体的な数値が必要な場合は print() で出力して把握
```

### ブラウザ上でリアルタイム表示する分析フロー

ユーザーがブラウザでノートブックを開いている場合、以下のフローでAIの操作をリアルタイムに表示できる。

```
1. workspace_create でワークスペースを作成（または workspace_list で既存を選択）
2. session_create(workspace_id=..., notebook_path="analysis.ipynb") でセッション作成
3. notebook_add_cell でセル追加（自動ロック → ブラウザにリアルタイム反映 → 自動アンロック）
4. execute_code でコード実行（自動ロック → ブラウザにリアルタイム反映 → 自動アンロック）
5. 必要に応じて 3-4 を繰り返す
```

### 画像確認のベストプラクティス

- 可視化コードを実行したら、`images` 配列で画像生成の有無・枚数・説明を確認する
- 画像の詳細内容が必要な場合は、数値データを併用するパターンで対応する（下記参照）
- ユーザーはJupyterLab ブラウザで画像を直接確認できる

### グラフと数値データの併用（重要）

**AIの画像認識の特性:**
- グラフから「傾向」「パターン」「比較」は把握できる
- 正確な数値の読み取りは困難（軸の目盛りから値を精密に読むなど）

**推奨パターン:**
グラフで傾向を確認し、具体的な数値が必要な場合は別途データを出力する。

```python
# 良い例：グラフと数値データを両方出力
import matplotlib.pyplot as plt

# グラフで傾向を可視化
plt.figure(figsize=(10, 6))
plt.plot(df['date'], df['sales'])
plt.title('月別売上推移')
plt.show()

# 具体的な数値も出力（AIが正確に読める）
print("=== 売上サマリー ===")
print(f"最大: {df['sales'].max():,.0f} ({df.loc[df['sales'].idxmax(), 'date']})")
print(f"最小: {df['sales'].min():,.0f} ({df.loc[df['sales'].idxmin(), 'date']})")
print(f"平均: {df['sales'].mean():,.0f}")
print()
print(df[['date', 'sales']].to_string())
```

**使い分けの指針:**

| 目的 | 方法 |
|------|------|
| 全体的なトレンド確認 | グラフを見る |
| 異常値・外れ値の発見 | グラフを見る |
| カテゴリ間の大小比較 | グラフを見る |
| 特定時点の正確な値 | 数値データを出力 |
| 集計値（合計、平均等） | 数値データを出力 |
| 複数値の比較計算 | 数値データを出力 |

長時間の分析では、定期的に get_variables で状態を確認し、必要に応じてノートブックに保存することを推奨。
