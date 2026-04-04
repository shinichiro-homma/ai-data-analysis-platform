# Workspace（cross-cutting）

ワークスペース分離、環境管理、セキュリティに関する Phase。

---

## Phase 1: ワークスペース分離

チャット（AI会話）ごとに独立した作業空間を提供する機能。ワークスペースはファイルシステム上のサブディレクトリとして永続化され、MCP再起動後も再利用可能。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 1.1 | ワークスペース作成・一覧 | [x] | workspace_createでワークスペースが作成され、workspace_listで一覧に表示される | jupyter-server API + jupyter-mcp ツール |
| 1.2 | 既存ツールのワークスペーススコープ対応 | [x] | session_create(workspace_id=...)でカーネルcwdがワークスペースに設定される。file_listでワークスペース内のファイルのみ表示される | session_create, file_list, notebook_create の修正 |
| 1.3 | ワークスペース分離の結合テスト | [x] | ワークスペースA・B各々にノートブックを作成し、互いのfile_listに表示されないことを確認。MCP再起動後もworkspace_listで再発見可能 | |
| 1.4 | ワークスペース data/output ディレクトリ | [x] | workspace_create でワークスペースに data/ と output/ が自動作成される。カーネルから data/ にファイルを書き込み、file_list で確認できる | グローバル DATA_DIR/OUTPUT_DIR を廃止し、ワークスペーススコープに統一 |
| 1.5 | ワークスペース間アクセス制限 | [x] | ワークスペースAのセッションから execute_code でワークスペースBのパスにアクセスしようとするとエラーになる | Python スタートアップスクリプトによるソフトな制限。デニーリスト方式で実装（7テスト成功） |
| 1.6 | ワークスペースメタデータ拡張・更新 | [x] | workspace_create で summary/status を指定でき、workspace_list で返却される。workspace_update で summary/status を更新できる | jupyter-server API（PUT /api/workspaces/{id}）+ jupyter-mcp ツール（workspace_update） |
| 1.7 | ワークスペースサマリ生成 | [x] | workspace_summarize でテンプレート・評価基準が返却され、AIがレポートを生成して SUMMARY.md に保存できる | jupyter-server API（POST /api/workspaces/{id}/summarize）+ jupyter-mcp ツール + テンプレートファイル。検証観点はツール description に含めない設計 |

---

## Phase 2: サンプル・本番データ分離

サンプルデータ（動作確認・検証用）と本番データ（実運用データ）を環境別ディレクトリで管理し、環境変数とスクリプトで簡単に切り替えられるようにする。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 2.1 | document-server データディレクトリ分離 | [x] | `DATA_ENV=sample` で起動時にサンプルデータが読み込まれ、`DATA_ENV=production` で本番データが読み込まれる | `data/` 配下を `sample/`, `production/` に分離。`config.py` の `DATA_DIR` 解決ロジック変更。既存テスト更新 |
| 2.2 | PostgreSQL データ分離 | [x] | `scripts/switch-env.sh sample` でサンプルCSVがロードされ、`scripts/switch-env.sh production` で本番CSVがロードされる | `postgres/data/` を `sample/`, `production/` に分離。`02-load-data.sh` の環境切り替え対応 |
| 2.3 | 環境切り替えスクリプト実装 | [x] | `scripts/switch-env.sh production` でPostgreSQLボリューム削除→本番データで再構築→document-server再起動が一括実行される。`jupyter_work` ボリュームは保持される | postgres_data ボリュームのみ個別削除、`.env` の `DATA_ENV` 書き換え、ヘルスチェック待機 |
| 2.4 | docker-compose 環境変数対応 | [x] | `.env` の `DATA_ENV` 値に応じて、document-server が正しい環境のデータを読み込む | `docker-compose.yml` に `DATA_ENV` 環境変数追加、`.env.example` 更新 |
| 2.5 | 本番データ用 .gitignore 設定 | [x] | `document-server/data/production/` と `postgres/data/production/` が git 管理外になっている | `.gitignore` 更新 |
| 2.6 | jupyter-server 環境切り替え対応 | [x] | `DATA_ENV=sample` でワークスペースが `/workspaces/sample/` 配下に、`DATA_ENV=production` で `/workspaces/production/` 配下に作成される。`switch-env.sh` で jupyter-server も再起動される | `WORKSPACE_ROOT_DIR` のデフォルトを `{DATA_ENV}` 含む形に変更、docker-compose に `DATA_ENV` 追加、switch-env.sh 更新 |

---

## Phase 3: 環境別ボリューム方式

環境ごとに独立した PostgreSQL データボリューム（`postgres_data_sample`, `postgres_data_production`）を保持し、環境切り替え時の不要なデータ再ロードを排除する。切り替えはボリュームの参照先変更のみで数秒で完了する。データに更新がある場合のみ、ユーザー確認の上で再ロードを実行する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 3.1 | 環境別ボリューム対応（docker-compose + スクリプト基盤） | [x] | `docker-compose up -d` で `DATA_ENV` に応じたボリューム（`postgres_data_sample` / `postgres_data_production`）が使用される。`scripts/switch-env.sh production` → `scripts/switch-env.sh sample` でボリュームが切り替わり、両方のデータが保持される | docker-compose.yml のボリューム名動的化、common.sh のヘルパー関数、rebuild.sh / clean-rebuild.sh の対応 |
| 3.2 | switch-env.sh のスキップ判定 + ユーザー確認フロー | [x] | 既存ボリュームがある環境に切り替え時「データに更新はありますか？」と確認され、N で再ロードなし（数秒で完了）、y で再ロード実行。初回（ボリュームなし）は自動でフルロード | switch-env.sh にボリューム存在チェック + 確認プロンプト追加 |

---

## Phase 4: シェルコマンド実行阻止

コード実行 API 経由でのシェルコマンド実行を多層防御で阻止するセキュリティ機能。AST 解析（主防御）+ sandbox + IPython マジック無効化 + Terminals API 無効化 + PostgreSQL read-only ロールの5層で防御する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 4.1 | AST 解析 + ホワイトリスト検査（主防御） | [x] | `POST /api/kernels/{id}/execute` で `import subprocess` を含むコードがカーネル到達前にブロックされる。`import pandas` 等のデータ分析コードは正常に実行される | kernel_executor.py または handlers.py に AST 検査ロジック追加。ホワイトリスト定義 |
| 4.2 | sandbox 強化（二重防御） | [x] | `os.system("ls")` を execute_code で実行するとブロックされる。`os.path.join` 等の安全な関数は使用可能 | workspace_sandbox.py に subprocess/os.system/os.exec*/asyncio 等の monkey patch 追加 |
| 4.3 | IPython シェルマジック無効化（二重防御） | [x] | `!ls` を execute_code で実行するとブロックされる。`%%bash` セルマジックも無効 | カーネル起動時設定。exec_lines または startup スクリプトで無効化 |
| 4.4 | Terminals API 無効化 | [x] | `GET /api/terminals` が 403 または 404 を返す | jupyter_server_config.py に `terminals_enabled = False` 追加 |
| 4.5 | PostgreSQL read-only ロール（SQL防御） | [x] | `execute_sql` で `DELETE FROM table` を実行すると PostgreSQL 側で拒否される。`SELECT` は正常に動作する | `jupyter_readonly` ロール作成、`DATABASE_URL` の接続ユーザー変更、init スクリプト更新 |
