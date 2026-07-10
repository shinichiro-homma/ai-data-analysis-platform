# REST API 契約

> リクエスト/レスポンスのスキーマ・パラメータ・エラーの詳細は**コードが正**。
> このファイルはエンドポイントの一覧（CI がコードと照合）と、コンポーネント間契約の設計方針のみを持つ。
> パス中のパラメータは `{name}` 形式で表記する（jupyter-server はハンドラ引数名、document-server は FastAPI のパスパラメータ名に対応）。

## jupyter-server

（実装: `jupyter-server/extensions/custom_api/`。ルート表は `handlers.py` の `get_handlers()` が正）

| メソッド | パス | 目的 |
|---------|------|------|
| GET | /health | ヘルスチェック |
| GET | /api/kernels | カーネル一覧を取得 |
| POST | /api/kernels | カーネルを起動 |
| GET | /api/kernels/{kernel_id} | カーネルの状態を取得 |
| DELETE | /api/kernels/{kernel_id} | カーネルを停止 |
| POST | /api/kernels/{kernel_id}/interrupt | 実行中コードを中断（ロック貫通） |
| POST | /api/kernels/{kernel_id}/restart | カーネルを再起動 |
| POST | /api/kernels/{kernel_id}/execute | コードを実行 |
| GET | /api/kernels/{kernel_id}/variables | 変数一覧を取得 |
| GET | /api/kernels/{kernel_id}/variables/{name} | 変数の詳細を取得 |
| GET | /api/custom/contents | ファイル一覧を取得 |
| POST | /api/custom/contents | ノートブック/ファイルを作成 |
| GET | /api/custom/contents/{path} | ファイル/ノートブックの内容を取得 |
| POST | /api/custom/contents/{path} | 指定パス配下にノートブック/ファイルを作成 |
| PUT | /api/custom/contents/{path} | ファイル/ノートブックを更新 |
| DELETE | /api/custom/contents/{path} | ファイル/ノートブックを削除 |
| GET | /api/custom/contents/{path}/cells | ノートブックのセル一覧を取得 |
| PATCH | /api/custom/contents/{path}/cells | セルを追加・更新・削除・並替・結合・分割・型変更・複製・出力クリア |
| POST | /api/custom/contents/{path}/cells/{index}/execute | 指定セルを再実行 |
| POST | /api/custom/contents/{path}/cells/execute-batch | セルを一括実行 |
| POST | /api/custom/contents/{path}/cells/clear-all-outputs | 全セルの出力をクリア |
| GET | /api/custom/contents/{path}/preview | CSV/Parquet ファイルの構造をプレビュー |
| POST | /api/custom/sessions | ワークスペース対応セッションを作成 |
| WS | /api/ai/events | AI 操作イベントを配信（WebSocket） |
| POST | /api/ai/events/broadcast | AI イベントを送信（全クライアントへ配信） |
| POST | /api/workspaces | ワークスペースを作成 |
| GET | /api/workspaces | ワークスペース一覧を取得 |
| PUT | /api/workspaces/{workspace_id} | ワークスペースのメタデータを更新 |
| POST | /api/workspaces/{workspace_id}/summarize | サマリ生成用テンプレート・評価基準を取得 |
| POST | /api/sql/execute | SQL を実行（SELECT は結果を CSV 保存） |
| POST | /api/sql/export | SQL 結果を Parquet/CSV へストリーミング書き出し |

## document-server

（実装: `document-server/src/routers/`, `src/main.py`。prefix は各 router 定義: /catalog, /glossary, /logic, /admin）

| メソッド | パス | 目的 |
|---------|------|------|
| GET | /health | ヘルスチェック（認証免除） |
| GET | /catalog/index | 全テーブルのインデックスを取得 |
| POST | /catalog/tables | テーブル詳細を一括取得 |
| GET | /glossary/index | 用語インデックスを取得（query で部分一致検索） |
| POST | /glossary/terms | 用語詳細を一括取得 |
| GET | /logic/index | 全ロジックのインデックスを取得 |
| POST | /logic/meta | ロジックのメタ情報を一括取得 |
| GET | /logic/code/{logic_name} | ロジックのコードファイル内容を取得 |
| POST | /admin/reload | カタログ・用語集・ロジックを再読み込み |

## 共通契約方針

コードから読み取れない Why レベルの設計判断のみを記す。パラメータ・スキーマ・エラーコードの全量はコードが正。

### 認証

- jupyter-server: Jupyter Server 標準のトークン認証（`Authorization: Bearer {token}`。WebSocket はクエリパラメータ `token`）。`/health` は Docker ヘルスチェック用途のため実装上も認証必須だが、その他エンドポイントと同様に扱う。
- document-server: `DOCUMENT_SERVER_TOKEN` による Bearer 認証。`/health` のみ認証免除（Docker ヘルスチェックが叩くため）。それ以外は全ルートが `verify_token` 依存で保護される。

### レスポンス形式

- 成功時は `{"data": ...}`、エラー時は `{"error": {"code": ..., "message": ...}}` で統一する。MCP サーバー側がこの形状に依存して結果/エラーを判別するため、両サーバーで共通形式を守る。

### エラー時の情報開示

- 本番環境では内部エラーの詳細・スタックトレースを外部に出さない（`INTERNAL_ERROR` 等の汎用メッセージに丸める）。詳細はサーバーログにのみ残す。

### コード実行・SQL 実行の安全性（jupyter-server 固有）

- コード実行は AST 検査を主防御とする多層防御（sandbox・IPython マジック無効化・Terminals API 無効化を併用）で、シェルコマンド実行等をブロックする。
- SQL 実行はブラックリスト方式で危険操作（DELETE, ALTER, GRANT/REVOKE, VACUUM, ANALYZE, 非 TEMP の CREATE TABLE, CREATE/DROP INDEX 等）を拒否し、加えて PostgreSQL の read-only ロールで書き込みを DB レベルでも拒否する。`/api/sql/export` は SELECT のみ許可。
- 実行には必ずタイムアウトを設ける（無限ループ防止）。既定値・上限はコードの定数が正。

### 契約上の設計判断（Why）

- カスタム Contents API は `/api/contents` ではなく `/api/custom/contents` に置く。JupyterLab フロントエンドが使う標準 `/api/contents` と競合させないため。
- ノートブック/ファイル作成（POST contents）は既存ファイルを上書きせず、同名時は自動連番（`{name}_2` …）で別名作成する。AI の誤操作による既存成果物の破壊を防ぐため、レスポンスの `path` は実際に作成されたパスを返す。
- `interrupt` は AI 編集ロック中でも実行可能（ロック貫通）。暴走中の実行を止める操作をロックで阻害しないため。
- AI 編集ロックの開始/終了イベント（`ai_edit_start` / `ai_edit_end`）は jupyter-mcp の `handleToolCall` ミドルウェアがノートブック編集系ツール実行時に自動配信する内部イベントであり、独立した MCP ツール/エンドポイントとしては提供しない。
