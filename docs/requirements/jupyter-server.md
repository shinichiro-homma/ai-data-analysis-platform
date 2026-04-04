# jupyter-server 要件定義

## 概要

JupyterLabをベースとしたデータ分析実行環境。生成AIからのコード実行リクエストを受け付け、結果を返却する。

## 機能要件

### F1: カーネル管理

#### F1.1: カーネル起動
- Pythonカーネルを起動できる
- 複数カーネルの同時起動をサポート（最大5つ）※同時カーネル上限の強制は Phase 未着手
- カーネルごとに独立した名前空間を持つ

#### F1.2: カーネル停止
- 指定したカーネルを停止できる
- 全カーネルの一括停止ができる

#### F1.3: カーネル状態確認
- カーネルの状態（idle/busy/dead）を取得できる
- 起動中のカーネル一覧を取得できる

### F2: コード実行

#### F2.1: コード実行
- 任意のPythonコードを実行できる
- 実行結果（stdout, stderr, 戻り値）を取得できる
- 画像出力（matplotlib等）をbase64形式で取得できる

#### F2.2: 実行制御
- 実行中のコードを中断できる
- タイムアウト設定が可能（デフォルト値・最大値は `jupyter-server/extensions/custom_api/base.py` の `validate_timeout()` を参照）

#### F2.3: 変数管理
- カーネル内の定義済み変数一覧を取得できる
- 変数の値を取得できる（JSONシリアライズ可能なもの）
- DataFrameの場合、shape/columns/dtypes/head を取得できる

### F3: ノートブック管理

#### F3.1: ノートブック作成
- 新規ノートブックを作成できる
- 指定した名前で保存できる
- ワークスペースディレクトリ配下のパスを指定して作成できる
- 同名のファイルが既に存在する場合、自動連番で別名のノートブックを作成する
  - 連番ルール: `{name}.ipynb` → `{name}_2.ipynb` → `{name}_3.ipynb` → ...
  - レスポンスには実際に作成されたパスを返す

#### F3.2: ノートブック読み込み
- 既存のノートブックを開ける
- セル一覧を取得できる

#### F3.3: セル操作
- セルの追加/編集/削除ができる
- セルの実行ができる
- セルの出力を取得できる
- セルの一覧を取得できる（各セルのソース、出力、実行回数を含む）
- 指定セルのコードをカーネルで再実行し、出力と実行回数を更新できる

### F4: AI同期イベント配信

#### F4.1: WebSocketエンドポイント
- `/api/ai/events` WebSocketエンドポイントを提供する
- JupyterLab拡張（jupyterlab-ai-sync）がこのエンドポイントに接続する
- 認証トークンによるアクセス制御を行う
- 複数クライアントの同時接続をサポートする

#### F4.2: イベント配信
- jupyter-mcpからのAPI呼び出し時に、対応するイベントをWebSocket経由で配信する
- 以下のイベントタイプを配信する:
  - `ai_edit_start` - AI編集開始（ノートブックロック指示）
  - `cell_added` - セル追加完了
  - `cell_execute_start` - セル実行開始
  - `cell_output` - セル出力（ストリーミング、stdout/stderr/display_data/execute_result/error）
  - `cell_execute_end` - セル実行完了
  - `ai_edit_end` - AI編集終了（ノートブックアンロック指示）

#### F4.3: コード実行時のイベント配信

> **注:** 本要件は jupyter-server 側での自動配信として定義されていたが、タスク 9.2 の設計判断により jupyter-mcp 側から `POST /api/ai/events/broadcast` を通じて実行結果をイベント配信する方式で実現された。jupyter-server 内の `kernel_executor.py` から WebSocket への自動ストリーミングは実装していない。

- `POST /api/kernels/{id}/execute` の実行結果は、jupyter-mcp が `POST /api/ai/events/broadcast` を通じてWebSocketイベントとして配信する
- jupyter-mcp が実行開始時に`cell_execute_start`、各出力で`cell_output`、完了時に`cell_execute_end`を配信する

### F5: ファイル管理

#### F5.1: データファイルアクセス
- 指定ディレクトリ内のファイル一覧を取得できる
- CSVなどのデータファイルを読み込める
- ワークスペースディレクトリ配下のファイルアクセスをサポートする

### F7: SQL実行

#### F7.1: SQLクエリ実行
- `DATABASE_URL` 環境変数で指定されたデータベースに **read-only ロール**（`jupyter_readonly`）で接続し、SQLクエリを実行できる
- PostgreSQL ロール権限が書き込み操作の一次防御となり、以下のブラックリストは二重防御として機能する
- クエリ結果をCSVファイルとしてワークスペースの `data/` ディレクトリに保存する
- 危険なSQL命令句をブラックリスト方式で**拒否**する（詳細は `sql_handlers.py` の `BLOCKED_COMMANDS` および `_classify_sql()` を参照）
- ブラックリスト外のSQL命令は実行可能。ただし CREATE / DROP は後続トークンを `sqlparse` で解析し安全性を判定する:
  - CREATE: TEMP TABLE / TEMPORARY TABLE / OR REPLACE FUNCTION のみ許可
  - DROP: TABLE / FUNCTION のみ許可
- SELECT以外の命令句（DDL/DML/トランザクション系）は結果セットを返さないため、CSV保存は行わない
- クエリ結果のメタデータ（行数、カラム一覧、ファイルパス、ファイルサイズ）を返却する

#### F7.2: SQL実行制御
- タイムアウト設定が可能（デフォルト値・最大値は `jupyter-server/extensions/custom_api/sql_handlers.py` を参照）
- 結果行数の上限を設定可能（デフォルト値は `jupyter-server/extensions/custom_api/sql_handlers.py` を参照）
- 接続エラー・クエリエラー時に適切なエラーメッセージを返却する

#### F7.3: SQLデータエクスポート
- SQLクエリの結果をワークスペースの `data/` ディレクトリにParquet/CSVファイルとして直接書き出す
- ストリーミング処理（チャンク単位）でメモリ使用量を一定に抑える（チャンクサイズは `jupyter-server/extensions/custom_api/sql_handlers.py` を参照）
- 行数制限なし
- デフォルトの出力形式は Parquet。format パラメータで CSV も指定可能
- SELECT文のみエクスポート対象（非SELECT文はバリデーションエラー）
- タイムアウト設定が可能（デフォルト値・最大値は `jupyter-server/extensions/custom_api/sql_handlers.py` を参照）
- レスポンスに file_path, row_count, file_size_bytes, format, execution_time_ms を含む

### F6: ワークスペースディレクトリ管理

#### F6.1: ワークスペースディレクトリ作成
- ワークスペース用のサブディレクトリを作成できる
- ディレクトリは `{WORKSPACE_ROOT_DIR}/{workspace_id}/` に作成される
- ディレクトリにメタデータファイル（名前、作成日時、サマリ、ステータス）を保存する
- ワークスペース作成時に `data/` と `output/` サブディレクトリを自動作成する
  - `data/`: 分析用入力データの配置場所
  - `output/`: 分析結果の出力先

#### F6.2: ワークスペースディレクトリ一覧
- 既存のワークスペースディレクトリ一覧を取得できる
- 各ワークスペースのメタデータ（名前、作成日時、ファイル数、サマリ、ステータス）を返却する

#### F6.4: ワークスペースメタデータ更新
- 既存ワークスペースのメタデータ（サマリ、ステータス）を更新できる
- `PUT /api/workspaces/{workspace_id}` で更新する
- 更新対象は `summary` と `status` のみ（`name` や `workspace_id` は変更不可）

#### F6.5: ワークスペースサマリ生成
- ワークスペースの作業内容に基づいて検証レポートを生成するためのテンプレートと評価基準を提供する
- `POST /api/workspaces/{workspace_id}/summarize` でテンプレートと評価基準を返却する
- テンプレートと評価基準はサーバー側のファイルに格納し、ツール定義（description）には含めない
- AIはレスポンスに含まれるテンプレートに従ってレポートを生成し、SUMMARY.md としてワークスペースに保存する

#### F6.3: ワークスペース間アクセス制限
- カーネル起動時に Python スタートアップスクリプトを注入し、ファイルアクセスをワークスペースディレクトリ内に制限する
- カーネル内の Python コードが、自ワークスペース外のパスにアクセスしようとした場合、エラーを返す
- `os.chdir()` による作業ディレクトリの変更をワークスペース内に制限する

#### F5.2: 出力ファイル管理
- 分析結果をファイルとして保存できる
- 保存したファイルをダウンロードできる

## 非機能要件

### NF1: パフォーマンス

| 項目 | 要件 |
|------|------|
| カーネル起動時間 | 10秒以内 |
| コード実行開始 | リクエストから1秒以内 |
| 同時実行カーネル数 | 最大5 |
| 最大出力サイズ | 1MB/実行 |

### NF2: セキュリティ

- 信頼されたネットワーク内でのみ動作を想定
- ファイルアクセスは指定ディレクトリ内に制限（F6.3）

#### NF2.1: シェルコマンド実行の阻止

コード実行 API（`POST /api/kernels/{id}/execute`）経由でのシェルコマンド実行を多層防御で阻止する。

**脅威モデルの前提:**
- AI は MCP 経由でのみ jupyter-server にアクセスする
- jupyter-server REST API はトークン認証で保護されている（信頼されたネットワーク内）
- 主な脅威は AI の誤用（意図しないシェル実行）およびプロンプトインジェクション
- Python の動的言語特性（リフレクション、メタプログラミング）により、アプリレベルでの完全な阻止は原理的に不可能
- Docker コンテナが最終的なセキュリティ境界となる

**防御レイヤー:**

| # | レイヤー | 対策 | 役割 |
|---|---------|------|------|
| 1 | API（主防御） | AST 解析 + ホワイトリスト検査 | 危険なコードをカーネル到達前にブロック |
| 2 | API | Jupyter Terminals API の無効化（`terminals_enabled = False`） | ターミナル経由のシェルアクセスを遮断 |
| 3 | アプリ（二重防御） | sandbox 強化（monkey patch） | AST 検査をすり抜けた場合の保険 |
| 4 | アプリ（二重防御） | IPython シェルマジック無効化 | `!command`, `%%bash` 等の無効化 |
| 5 | インフラ（境界） | Docker コンテナ隔離 | 万が一の突破時の被害限定 |

**レイヤー1: AST 解析 + ホワイトリスト検査（主防御）**

`POST /api/kernels/{id}/execute` の API ハンドラで、コードをカーネルに渡す前に Python `ast` モジュールで静的解析を行う。MCP 経由・curl 直接アクセスの両方がこの検査を通る。詳細は `code_validator.py` を参照。

**レイヤー2: Terminals API 無効化**

`jupyter_server_config.py` で `c.ServerApp.terminals_enabled = False` を設定し、Terminals API（`/api/terminals`）を完全に無効化する。

**レイヤー3: sandbox 強化（二重防御）**

`workspace_sandbox.py` で危険な関数・モジュールを monkey patch でブロックする。AST 検査の保険として機能する。詳細は `workspace_sandbox.py` の `_setup_workspace_sandbox()` を参照。

**レイヤー4: IPython シェルマジック無効化（二重防御）**

カーネル起動時にシェルマジック・シェル実行メソッドを無効化する。詳細は `workspace_sandbox.py` を参照。

#### NF2.2: SQL 実行のインフラレベル防御

- PostgreSQL への接続は read-only ロール（`jupyter_readonly`）で行い、データベースレベルで全書き込み操作を拒否する
- これにより DELETE, ALTER, GRANT, REVOKE, COPY PROGRAM 等が PostgreSQL 側で拒否される
- アプリケーション側の BLOCKED_COMMANDS（F7.1）は二重防御として維持する

### NF3: 可用性

- カーネルクラッシュ時、自動的に新しいカーネルを起動可能（Phase未着手）
- 長時間アイドル状態のカーネルは自動シャットダウン（`KERNEL_TIMEOUT` 秒、デフォルト1800秒=30分）
  - Jupyter Server 標準の `MappingKernelManager.cull_idle_timeout` を使用
  - WebSocket 接続中のカーネルは対象外（`cull_connected=False`）
  - busy 状態のカーネルは対象外（`cull_busy=False`）
  - culler による停止時も `_kernel_workspace_map` と画像カウンターをクリーンアップする

### NF4: 運用性

- Dockerコンテナとしてデプロイ
- 環境変数で設定を変更可能
- ヘルスチェックエンドポイントを提供
- サンプルデータと本番データを環境変数 `DATA_ENV` で切り替え可能（デフォルト: `sample`）
- `DATA_ENV` に応じてワークスペースルートディレクトリが自動解決される（`/home/jovyan/work/workspaces/{DATA_ENV}`）
- 環境ごとにワークスペースが分離され、異なる環境のワークスペースが混在しない

## 技術仕様

### ベースイメージ

```dockerfile
FROM jupyter/scipy-notebook:python-3.11
```

### プリインストールライブラリ

- ベースイメージ（`jupyter/scipy-notebook`）同梱: pandas, numpy, matplotlib, seaborn, scikit-learn, scipy, sqlalchemy
- 追加インストール: `jupyter-server/requirements.txt` を参照

### 公開API

Jupyter Server標準APIとカスタム拡張APIを使用:

**カーネル管理（カスタム拡張）:**

| エンドポイント | 用途 |
|---------------|------|
| `GET /api/kernels` | カーネル一覧 |
| `POST /api/kernels` | カーネル起動 |
| `GET /api/kernels/{id}` | カーネル情報取得 |
| `DELETE /api/kernels/{id}` | カーネル停止 |
| `POST /api/kernels/{id}/interrupt` | カーネル中断 |
| `POST /api/kernels/{id}/restart` | カーネル再起動 |
| `POST /api/kernels/{id}/execute` | コード実行 |
| `GET /api/kernels/{id}/variables` | 変数一覧取得 |
| `GET /api/kernels/{id}/variables/{name}` | 変数詳細取得 |

**コンテンツ管理（カスタム拡張）:**

| エンドポイント | 用途 |
|---------------|------|
| `GET /api/custom/contents` | ルートファイル一覧 |
| `POST /api/custom/contents` | ファイル作成 |
| `GET /api/custom/contents/{path}` | ファイル取得 |
| `PUT /api/custom/contents/{path}` | ファイル更新 |
| `DELETE /api/custom/contents/{path}` | ファイル削除 |
| `GET /api/custom/contents/{path}/cells` | セル一覧取得 |
| `PATCH /api/custom/contents/{path}/cells` | セル操作 |
| `POST /api/custom/contents/{path}/cells/{index}/execute` | セル再実行 |

**ワークスペース・セッション管理:**

| エンドポイント | 用途 |
|---------------|------|
| `POST /api/workspaces` | ワークスペース作成 |
| `GET /api/workspaces` | ワークスペース一覧 |
| `PUT /api/workspaces/{workspace_id}` | ワークスペースメタデータ更新 |
| `POST /api/workspaces/{workspace_id}/summarize` | サマリ生成用テンプレート・評価基準返却 |
| `POST /api/custom/sessions` | セッション作成 |

**SQL実行:**

| エンドポイント | 用途 |
|---------------|------|
| `POST /api/sql/execute` | SQL実行・結果CSV保存 |
| `POST /api/sql/export` | SQLデータエクスポート（Parquet/CSV、ストリーミング書き出し） |

**AI同期イベント:**

| エンドポイント | 用途 |
|---------------|------|
| `WS /api/ai/events` | AI同期イベント配信（WebSocket） |
| `POST /api/ai/events/broadcast` | AI同期イベント送信 |

**ヘルスチェック:**

| エンドポイント | 用途 |
|---------------|------|
| `GET /health` | ヘルスチェック |

### ポート

- 8888: JupyterLab UI / REST API

### 環境変数

> **正（SSoT）**: 環境変数の定義は各コンポーネントの `CLAUDE.md` を参照。ここでは要件としての説明のみ記載。

デフォルト値は `jupyter-server/CLAUDE.md` を参照。

| 変数名 | 説明 |
|--------|------|
| `JUPYTER_TOKEN` | 認証トークン |
| `KERNEL_TIMEOUT` | カーネルアイドルタイムアウト（秒） |
| `EXECUTION_TIMEOUT` | コード実行タイムアウト（秒） |
| `MAX_OUTPUT_SIZE` | 最大出力サイズ（バイト） |
| `DATA_ENV` | データ環境（sample / production） |
| `WORKSPACE_ROOT_DIR` | ワークスペースルートディレクトリ |
| `DATABASE_URL` | データベース接続URL |

## 受け入れ条件

### AC1: カーネル管理
- [ ] カーネルを起動し、状態が「idle」になることを確認
- [ ] 複数カーネルを同時に起動できる
- [ ] カーネルを停止し、一覧から消えることを確認

### AC2: コード実行
- [ ] `print("hello")` を実行し、stdout に "hello" が返る
- [ ] `1/0` を実行し、ZeroDivisionError がstderrに返る
- [ ] matplotlibでグラフを描画し、base64画像が返る
- [ ] matplotlibで日本語ラベルを含むグラフを描画し、文字化けなく画像が返る
- [ ] 30秒以上かかるコードがタイムアウトする

### AC3: 変数管理
- [ ] `x = 42` 実行後、変数一覧に `x` が含まれる
- [ ] DataFrameを作成し、schema情報が取得できる

### AC4: ノートブック
- [ ] 新規ノートブックを作成できる
- [ ] 同名ノートブック作成時に自動連番（`_2`, `_3`, ...）で作成される
- [ ] 自動連番時に元のノートブックのセルが保全される
- [ ] セルを追加・実行・削除できる
- [ ] ノートブックを保存・再読み込みできる
- [ ] セル一覧を取得でき、各セルのソース・出力・実行回数が含まれる
- [ ] 既存セルのソースコードを編集できる
- [ ] 指定セルをカーネルで再実行し、出力と実行回数が更新される
- [ ] 範囲外のセルインデックスを指定した場合にエラーが返る

### AC5: AI同期イベント
- [ ] `/api/ai/events` WebSocketエンドポイントに接続できる
- [ ] `POST /api/ai/events/broadcast` でイベントを送信すると、WebSocket接続中のクライアントにブロードキャストされる
- [ ] コード実行中にIOPubメッセージがリアルタイムでWebSocketイベントとして配信される（※タスク 9.2 の設計判断により jupyter-mcp 側で実現。F4.3 注記参照）

### AC6: ワークスペース
- [ ] `POST /api/workspaces` でワークスペースディレクトリが作成される
- [ ] `POST /api/workspaces` で `summary` と `status` を指定した場合、メタデータに保存される
- [ ] `GET /api/workspaces` でワークスペース一覧が取得でき、各ワークスペースに `summary` と `status` が含まれる
- [ ] `PUT /api/workspaces/{workspace_id}` で `summary` と `status` を更新できる
- [ ] `POST /api/workspaces/{workspace_id}/summarize` でテンプレートと評価基準が返却される
- [ ] ワークスペースディレクトリ内にノートブックを作成できる
- [ ] ワークスペースディレクトリ配下のファイル一覧を取得できる
- [ ] ワークスペース作成時に `data/` と `output/` サブディレクトリが自動作成される
- [ ] カーネル内の Python コードで `data/` と `output/` にアクセスできる
- [ ] カーネル内の Python コードがワークスペース外のパスにアクセスしようとするとエラーになる
- [ ] `os.chdir()` でワークスペース外に移動しようとするとエラーになる

### AC7: SQL実行
- [x] `POST /api/sql/execute` でSELECTクエリを実行し、結果がCSVファイルとしてワークスペースの `data/` に保存される
- [x] レスポンスに行数・カラム一覧・ファイルパス・ファイルサイズが含まれる
- [x] DDL系（CREATE TEMP TABLE, DROP TABLE等）、DML系（INSERT INTO, UPDATE）、トランザクション系（BEGIN, COMMIT, ROLLBACK）のクエリが正常に実行される
- [x] DELETE文を実行しようとするとエラーが返る
- [ ] ALTER, GRANT, REVOKE, VACUUM, ANALYZE, CREATE TABLE（非TEMP）, CREATE INDEX, DROP INDEX を実行しようとするとエラーが返る
- [ ] CREATE TEMP TABLE / CREATE OR REPLACE FUNCTION は正常に実行される（後続トークン判定）
- [ ] DROP TABLE / DROP FUNCTION は正常に実行される（後続トークン判定）
- [ ] 非SELECT命令の実行時にCSV保存が行われず、affected_rows を含むレスポンスが返る
- [x] タイムアウト設定が機能する
- [x] 存在しないテーブルへのクエリ時に適切なエラーメッセージが返る
- [x] DATABASE_URL が未設定の場合に適切なエラーメッセージが返る

### AC10: SQLデータエクスポート
- [ ] `POST /api/sql/export` でSELECTクエリを実行し、結果がワークスペースの `data/` にParquetファイルとして保存される
- [ ] format 未指定時にデフォルトで Parquet 形式で出力される
- [ ] format: "csv" 指定時に CSV 形式で出力される
- [ ] レスポンスに file_path, row_count, file_size_bytes, format, execution_time_ms が含まれる
- [ ] チャンク処理（fetchmany）によりメモリ使用量が一定に抑えられる
- [ ] 非SELECT文を指定するとバリデーションエラーが返る
- [ ] タイムアウト設定が機能する（デフォルト300秒）
- [ ] DATABASE_URL が未設定の場合に適切なエラーメッセージが返る

### AC8: シェルコマンド実行阻止
- [ ] `POST /api/kernels/{id}/execute` で `!ls` を送信するとエラーが返る（AST 検査）
- [ ] `POST /api/kernels/{id}/execute` で `import subprocess; subprocess.run(['ls'])` を送信するとエラーが返る（AST 検査）
- [ ] `POST /api/kernels/{id}/execute` で `import ctypes` を送信するとエラーが返る（AST 検査）
- [ ] `POST /api/kernels/{id}/execute` で `eval("__import__('subprocess')")` を送信するとエラーが返る（AST 検査: eval の呼び出し自体をブロック）
- [ ] `POST /api/kernels/{id}/execute` で `eval("1+1")` など静的引数でもエラーが返る（AST 検査: eval の呼び出し自体をブロック）
- [ ] `POST /api/kernels/{id}/execute` で `getattr(os, 'path')` を送信するとエラーが返る（AST 検査: getattr の呼び出し自体をブロック）
- [ ] Jupyter Terminals API（`/api/terminals`）へのリクエストが拒否される
- [ ] カーネル内で `os.system('ls')` を実行するとエラーが返る（sandbox monkey patch）
- [ ] カーネル内で `get_ipython().system('ls')` を実行するとエラーが返る（IPython マジック無効化）
- [ ] `POST /api/sql/execute` で `COPY ... TO PROGRAM` を送信すると PostgreSQL がエラーを返す（read-only ロール）

### AC9: AST ホワイトリスト検査
- [ ] 許可リストにあるモジュール（pandas, numpy, matplotlib 等）の import が正常に通る
- [ ] 許可リストにないモジュール（subprocess, ctypes, pty 等）の import がエラーになる
- [ ] `os.path.join()` 等の安全な os 関数は正常に通る
- [ ] `os.system()` 等の危険な os 関数はエラーになる
- [ ] 通常のデータ分析コード（DataFrame 操作、グラフ描画等）が影響なく実行できる

## 依存関係

- なし（最初に開発するコンポーネント）

## 次フェーズへの入力

このコンポーネントが提供するAPIを、jupyter-mcp が利用する。
