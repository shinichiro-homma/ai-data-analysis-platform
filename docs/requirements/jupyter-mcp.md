# jupyter-mcp 要件定義

## 概要

生成AIがJupyter環境を操作するためのMCPサーバー。jupyter-serverのREST APIをラップし、MCPツールとして提供する。

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
- セルの追加（code/markdown） ✓ notebook_add_cell で実装済み
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

#### F6.1: AI編集モードの自動制御
- ノートブック編集系ツール（`NOTEBOOK_EDIT_TOOLS`）の実行時に、`handleToolCall` ミドルウェアが自動的に `ai_edit_start` イベントを配信し、ノートブックをロック（read-only）する
- ツール実行完了後、ミドルウェアが自動的に `ai_edit_end` イベントを配信し、ロックを解除する
- ロック中はユーザーのキーボード入力・セル編集・セル実行を無効化する
- 対象ツールは `jupyter-mcp/src/tools/index.ts` の `NOTEBOOK_EDIT_TOOLS` Set で管理し、新しいノートブック操作ツール追加時は Set に追加するだけで自動対応される
- `ai_edit_start` / `ai_edit_end` は独立した MCP ツールとしては提供しない（内部自動処理のみ）
- カーネル中断は MCP ツールとしては提供しない（ユーザーが JupyterLab UI から直接実行する）

#### F6.3: AI操作のリアルタイム同期
- `execute_code`実行時、jupyter-mcp が `POST /api/ai/events/broadcast` を通じて実行状況をリアルタイム配信する
- `notebook_add_cell`実行時、jupyter-mcp がセル追加イベントを `POST /api/ai/events/broadcast` でリアルタイム配信する
- `notebook_edit_cell`、`notebook_delete_cell`、`notebook_execute_cell` 実行時も同様にリアルタイム配信する
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
- Jupyter Contents API 経由でファイルを取得し、MCP の image content type（`type: "image"`, `data: base64`, `mimeType`）で返す
- テキストレスポンス（`type: "text"`）に base64 データを含めない（コンテキストウィンドウ節約の方針を維持）
- `execute_code` のテキストレスポンスには引き続き `file_path` のみを含める

### F9: SQL実行・データ取得

#### F9.1: SQLクエリ実行
- SQLクエリを実行し、SELECT文の場合は結果をワークスペースの `data/` ディレクトリにCSVファイルとして保存できる
- jupyter-serverの `POST /api/sql/execute` を呼び出して実行する
- セッションIDからワークスペースを特定し、保存先を自動決定する
- 危険なSQL命令句をブラックリスト方式で**拒否**する（jupyter-server側で判定）。ブロック対象・許可条件の詳細は `jupyter-server/extensions/custom_api/sql_handlers.py` の `BLOCKED_COMMANDS` および `_classify_sql()` を参照
- 非SELECT命令は結果セットを返さないため、CSV保存は行わない（affected_rows を返却）

#### F9.2: 実行制御
- タイムアウト設定が可能（デフォルト値・最大値は `jupyter-mcp/src/tools/execute-sql.ts` を参照）
- 結果行数の上限を設定可能（デフォルト値は `jupyter-mcp/src/tools/execute-sql.ts` を参照）

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
- タイムアウト設定が可能（デフォルト値・最大値は `jupyter-mcp/src/tools/export-sql.ts` を参照）
- SELECT文のみエクスポート対象（非SELECT文はバリデーションエラー）

#### F11.3: 実行クエリの保存
- エクスポート成功時に、実行したSQLクエリを `data/queries/{連番}_{filename}.sql` としてワークスペースに保存する
- execute_sql の F9.3 と同じ共通ユーティリティ（`saveQueryFile`）を使用する
- レスポンスに `query_file_path` を含める

### F10: 外部データアップロード 【未実装】

#### F10.1: 外部データのアップロード
- チャットから提供されたファイル（CSV、Excel等）をワークスペースの `data/` ディレクトリにアップロードできる
- ホスト側のファイルパス（source_path）を受け取り、MCPサーバーが直接読み取ってアップロードする
- ファイル名を指定してワークスペース内に保存する
- 保存後、ファイルパス・ファイルサイズを返却する
- カタログで `data_source.type: external` として定義されているデータを、分析時に提供する際に使用する

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
- オプションで `summary`（作業内容の概要）と `status`（ステータス）を指定できる（文字数制限は `jupyter-mcp/src/utils/validation.ts` を参照）

#### F8.2: ワークスペース一覧
- 既存のワークスペース一覧を取得できる
- 各ワークスペースの名前、作成日時、ファイル数、サマリ、ステータスを返却する
- MCP再起動後も、ディスク上に存在するワークスペースを列挙できる

#### F8.4: ワークスペースメタデータ更新
- 既存ワークスペースの `summary` と `status` を更新できる
- `summary` は作業内容の概要（文字数制限は `jupyter-mcp/src/utils/validation.ts` を参照）
- `status` の許可値は `jupyter-mcp/src/utils/validation.ts` の `VALID_WORKSPACE_STATUSES` を参照

#### F8.5: ワークスペースサマリ生成
- ワークスペースの作業内容に基づいて検証レポートを生成するためのテンプレートと評価基準を取得する
- ユーザーから明示的にサマリ作成を依頼された場合のみ使用する
- レスポンスに含まれるテンプレートに従ってレポートを生成し、SUMMARY.md としてワークスペースに保存する
- テンプレートと評価基準はツール定義（description）には含めず、ツール実行時にサーバーから返却される

#### F8.3: ワークスペースの永続性
- ワークスペースのディレクトリとその中のファイル（ノートブック等）はディスク上に永続化される
- MCP/クライアント再起動後も `workspace_list` で既存ワークスペースを発見でき、`session_create` で新規セッションを紐付けられる
- カーネル（セッション）はアイドルタイムアウト後に停止するが、ファイルは保持される

## MCPツール定義

> 各ツールの `description` はコード（`jupyter-mcp/src/tools/index.ts`）を参照。以下では inputSchema（パラメータ構造）のみを定義する。

### workspace_create

新しいワークスペース（チャット独立の作業空間）を作成する。

```typescript
{
  name: "workspace_create",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "ワークスペース名"
      },
      summary: {
        type: "string",
        description: "ワークスペースの作業内容の概要"
      },
      status: {
        type: "string",
        description: "ワークスペースのステータス（デフォルト: not_started）。許可値は jupyter-mcp/src/utils/validation.ts の VALID_WORKSPACE_STATUSES を参照"
      }
    },
    required: ["name"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/workspace-create.ts` を参照。`data_path` / `output_path` はカーネルの作業ディレクトリからの相対パスで、カーネル内のコードでそのまま使用できる（例: `open('data/input.csv')`）。

### workspace_list

既存のワークスペース一覧を取得する。MCP再起動後も、ディスク上に存在するワークスペースを列挙できる。

```typescript
{
  name: "workspace_list",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/workspace-list.ts` を参照。

### workspace_update

既存ワークスペースのメタデータ（summary, status）を更新する。

```typescript
{
  name: "workspace_update",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: {
        type: "string",
        description: "更新対象のワークスペースID"
      },
      summary: {
        type: "string",
        description: "ワークスペースの作業内容の概要"
      },
      status: {
        type: "string",
        description: "ワークスペースのステータス。許可値は jupyter-mcp/src/utils/validation.ts の VALID_WORKSPACE_STATUSES を参照"
      }
    },
    required: ["workspace_id"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/workspace-update.ts` を参照。

### workspace_summarize

ワークスペースの作業内容をサマリーする。ユーザーから明示的に依頼された場合のみ使用する。

```typescript
{
  name: "workspace_summarize",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: {
        type: "string",
        description: "サマリー対象のワークスペースID"
      }
    },
    required: ["workspace_id"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/workspace-summarize.ts` を参照。サーバー側に格納されたテンプレートと評価基準を返却する。AIはこのレスポンスに従ってレポートを生成し、SUMMARY.md としてワークスペースに保存する。

### session_create

新しい分析セッションを作成する。

```typescript
{
  name: "session_create",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: {
        type: "string",
        description: "ワークスペースID。カーネルの作業ディレクトリがワークスペースに設定される"
      },
      notebook_path: {
        type: "string",
        description: "関連付けるノートブックのパス（ワークスペース内の相対パス）。指定するとユーザーがそのノートブックを開いたときに同じカーネルを共有できる"
      }
    },
    required: ["workspace_id"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/session-create.ts` を参照。`notebook_path` は `notebook_path` パラメータを指定した場合のみ返却される。`browser_url` は `notebook_path` 指定時はノートブックを直接開くURL、未指定時はワークスペースディレクトリを開くURLを返却する。

### session_list

アクティブなセッション一覧を取得する。

```typescript
{
  name: "session_list",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
```

### session_connect

既存のセッションに接続する。ブラウザで開いているノートブックと同じカーネルを使用できる。

```typescript
{
  name: "session_connect",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "接続したいノートブックのパス（例: analysis.ipynb）"
      },
      kernel_id: {
        type: "string",
        description: "接続したいカーネルのID。notebook_path の代わりに指定可能"
      }
    },
    required: []
  }
}
```

> `notebook_path` または `kernel_id` のどちらかを指定する必要がある（両方未指定の場合はバリデーションエラー）。

**戻り値・エラー時:** `jupyter-mcp/src/tools/session-connect.ts` を参照。

### session_delete

セッションを終了する。

```typescript
{
  name: "session_delete",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "終了するセッションID"
      }
    },
    required: ["session_id"]
  }
}
```

### execute_code

Pythonコードを実行する。

```typescript
{
  name: "execute_code",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      code: {
        type: "string",
        description: "実行するPythonコード。シェルコマンド実行（!command、subprocess、os.system、ctypes等）はブロックされます"
      },
      timeout: {
        type: "number",
        description: "タイムアウト秒数（デフォルト値・最大値は jupyter-mcp/src/tools/execute-code.ts を参照）"
      },
      cell_index: {
        type: "number",
        description: "実行対象のセルインデックス（notebook_add_cellの戻り値のcell_indexを指定。省略時は自動検出）"
      }
    },
    required: ["session_id"]
  }
}
```

**戻り値・エラー時:** `jupyter-mcp/src/tools/execute-code.ts` を参照。`images` 配列の各要素はファイルパス、MIMEタイプ、説明のみを含む。base64データは含まない。

### get_variables

定義済み変数の一覧を取得する。

```typescript
{
  name: "get_variables",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      }
    },
    required: ["session_id"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/get-variables.ts` を参照。

### get_dataframe_info

DataFrameの詳細情報を取得する。

```typescript
{
  name: "get_dataframe_info",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      variable_name: {
        type: "string",
        description: "DataFrame 変数名"
      },
      include_head: {
        type: "boolean",
        description: "先頭行を含めるか"
      },
      head_rows: {
        type: "number",
        description: "先頭何行を取得するか"
      }
    },
    required: ["session_id", "variable_name"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/get-dataframe-info.ts` を参照。

### notebook_create

新規ノートブックを作成する。ワークスペース内に作成される。同名ファイルが既に存在する場合はサーバー側で自動連番（`{name}_2.ipynb`, `{name}_3.ipynb`, ...）が付与される。

```typescript
{
  name: "notebook_create",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: {
        type: "string",
        description: "ワークスペースID"
      },
      session_id: {
        type: "string",
        description: "セッションID"
      },
      name: {
        type: "string",
        description: "ノートブック名（拡張子 .ipynb は不要）"
      }
    },
    required: ["workspace_id", "session_id", "name"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/notebook-create.ts` を参照。同名ファイル存在時はサーバー側で自動連番が付与され、実際のパスが戻り値に含まれる。

### notebook_add_cell

ノートブックにセルを追加する。

```typescript
{
  name: "notebook_add_cell",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス（例: analysis.ipynb）"
      },
      cell_type: {
        type: "string",
        enum: ["code", "markdown"],
        description: "セルの種類（code または markdown）"
      },
      source: {
        type: "string",
        description: "セルの内容"
      },
      position: {
        type: "number",
        description: "挿入位置（0-indexed、省略時は末尾に追加）"
      }
    },
    required: ["notebook_path", "cell_type", "source"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/notebook-add-cell.ts` を参照。`cell_index` は追加されたセルの実際のインデックス（0-indexed）で、`execute_code` の `cell_index` パラメータに渡して実行できる。

### notebook_list_cells

ノートブックの全セル一覧を取得する。各セルのソースコード、出力、実行回数を含む。過去に書いたコードを確認し、重複を避けるために使用する。

```typescript
{
  name: "notebook_list_cells",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス（例: analysis.ipynb）"
      }
    },
    required: ["notebook_path"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/notebook-list-cells.ts` を参照。

### notebook_edit_cell

ノートブックの既存セルのソースコードを編集する。

```typescript
{
  name: "notebook_edit_cell",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス（例: analysis.ipynb）"
      },
      cell_index: {
        type: "number",
        description: "編集対象のセルインデックス（0-indexed）"
      },
      source: {
        type: "string",
        description: "新しいセルの内容"
      }
    },
    required: ["notebook_path", "cell_index", "source"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/notebook-edit-cell.ts` を参照。

### notebook_delete_cell

ノートブックのセルを削除する。

```typescript
{
  name: "notebook_delete_cell",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス（例: analysis.ipynb）"
      },
      cell_index: {
        type: "number",
        description: "削除対象のセルインデックス（0-indexed）"
      }
    },
    required: ["notebook_path", "cell_index"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/notebook-delete-cell.ts` を参照。

### notebook_execute_cell

ノートブックの指定セルをカーネルで再実行する。セルのソースコードを取得してカーネルで実行し、セルの出力と実行回数を更新する。

```typescript
{
  name: "notebook_execute_cell",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス（例: analysis.ipynb）"
      },
      session_id: {
        type: "string",
        description: "セッションID（カーネルでの実行に必要）"
      },
      cell_index: {
        type: "number",
        description: "実行対象のセルインデックス（0-indexed）"
      },
      timeout: {
        type: "number",
        description: "タイムアウト秒数（デフォルト値は jupyter-mcp/src/tools/notebook-execute-cell.ts を参照）"
      }
    },
    required: ["notebook_path", "session_id", "cell_index"]
  }
}
```

**戻り値:** `jupyter-mcp/src/tools/notebook-execute-cell.ts` を参照。

### file_list

ワークスペース内のファイル一覧を取得する。

```typescript
{
  name: "file_list",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: {
        type: "string",
        description: "ワークスペースID"
      },
      path: {
        type: "string",
        description: "ワークスペース内の相対ディレクトリパス（省略時はワークスペースルート）"
      }
    },
    required: ["workspace_id"]
  }
}
```

### execute_sql

SQL命令を実行する。SELECT文の場合は結果をワークスペースの `data/` ディレクトリにCSVファイルとして保存する。危険な操作はブラックリスト方式で拒否する（対象リストは `jupyter-server/extensions/custom_api/sql_handlers.py` の `BLOCKED_COMMANDS` を参照）。

```typescript
{
  name: "execute_sql",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      sql: {
        type: "string",
        description: "実行するSQL文。ブロック対象の操作は拒否される（対象リストはコード参照）"
      },
      filename: {
        type: "string",
        description: "保存先ファイル名（data/ディレクトリ内、例: 'transactions.csv'）"
      },
      timeout: {
        type: "number",
        description: "タイムアウト秒数（デフォルト値・最大値は jupyter-mcp/src/tools/execute-sql.ts を参照）"
      },
      max_rows: {
        type: "number",
        description: "最大取得行数（デフォルト値は jupyter-mcp/src/tools/execute-sql.ts を参照）"
      }
    },
    required: ["session_id", "sql", "filename"]
  }
}
```

**戻り値・エラー時:** `jupyter-mcp/src/tools/execute-sql.ts` を参照。SELECT文はCSV保存＋`query_file_path`を返却、非SELECT文は`affected_rows`を返却（CSV保存なし）。クエリファイルは `data/queries/{連番}_{filename}.sql` に保存され、メタデータがSQLコメントとして記載される。

### export_sql

SQLクエリの結果をデータセットとしてワークスペースにファイル保存する。分析で使用するデータセットの作成・保存に使用する。結果はデフォルトでParquet形式、指定によりCSV形式で保存される。行数制限なし・ストリーミング処理のため大規模データにも対応。集計結果など少量のデータには execute_sql を使うこと。

```typescript
{
  name: "export_sql",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      sql: {
        type: "string",
        description: "実行するSELECT文。ブロック対象の操作は拒否される（対象リストはコード参照）"
      },
      filename: {
        type: "string",
        description: "保存先ファイル名（data/ディレクトリ内、例: 'purchase_history.parquet'）"
      },
      format: {
        type: "string",
        enum: ["parquet", "csv"],
        description: "出力形式（デフォルト: parquet）。ユーザーから指示があった場合のみ csv を指定"
      },
      timeout: {
        type: "number",
        description: "タイムアウト秒数（デフォルト値・最大値は jupyter-mcp/src/tools/export-sql.ts を参照）"
      }
    },
    required: ["session_id", "sql", "filename"]
  }
}
```

**戻り値・エラー時:** `jupyter-mcp/src/tools/export-sql.ts` を参照。

### notebook_reorder_cell

ノートブック内のセルを別の位置に移動する。

```typescript
{
  name: "notebook_reorder_cell",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックパス（例: analysis.ipynb）"
      },
      cell_index: {
        type: "number",
        description: "移動元のセルインデックス（0始まり）"
      },
      to_index: {
        type: "number",
        description: "移動先のインデックス（0始まり）"
      }
    },
    required: ["notebook_path", "cell_index", "to_index"]
  }
}
```

### notebook_execute_batch

ノートブックのセルを一括実行する。全セル / ここまで / これ以降の3モードをサポート。

```typescript
{
  name: "notebook_execute_batch",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス（例: analysis.ipynb）"
      },
      session_id: {
        type: "string",
        description: "セッションID"
      },
      mode: {
        type: "string",
        enum: ["all", "up_to", "from"],
        description: "実行モード（all: 全セル、up_to: 指定セルまで、from: 指定セル以降）"
      },
      cell_index: {
        type: "number",
        description: "基準セルインデックス（mode が up_to または from の場合に必須）"
      },
      timeout: {
        type: "number",
        description: "セルあたりのタイムアウト秒数"
      }
    },
    required: ["notebook_path", "session_id", "mode"]
  }
}
```

**戻り値:** 実行されたセル数、成功数、失敗したセルのインデックス（成功時は null）。

### notebook_merge_cells

複数の隣接セルを1つに結合する。

```typescript
{
  name: "notebook_merge_cells",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス"
      },
      start_index: {
        type: "number",
        description: "結合開始セルインデックス（0-indexed）"
      },
      end_index: {
        type: "number",
        description: "結合終了セルインデックス（0-indexed、この位置のセルを含む）"
      }
    },
    required: ["notebook_path", "start_index", "end_index"]
  }
}
```

### notebook_split_cell

セルを指定行で2つに分割する。

```typescript
{
  name: "notebook_split_cell",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス"
      },
      cell_index: {
        type: "number",
        description: "分割対象のセルインデックス（0-indexed）"
      },
      split_line: {
        type: "number",
        description: "分割行番号（1-indexed、この行から下が新しいセルになる）"
      }
    },
    required: ["notebook_path", "cell_index", "split_line"]
  }
}
```

### notebook_change_cell_type

セルのタイプを変更する（code ↔ markdown）。

```typescript
{
  name: "notebook_change_cell_type",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス"
      },
      cell_index: {
        type: "number",
        description: "対象セルインデックス（0-indexed）"
      },
      new_type: {
        type: "string",
        enum: ["code", "markdown"],
        description: "変更後のセルタイプ"
      }
    },
    required: ["notebook_path", "cell_index", "new_type"]
  }
}
```

### notebook_copy_cell

セルを指定位置にコピー（複製）する。

```typescript
{
  name: "notebook_copy_cell",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス"
      },
      source_index: {
        type: "number",
        description: "コピー元セルインデックス（0-indexed）"
      },
      target_index: {
        type: "number",
        description: "コピー先インデックス（0-indexed、省略時はソースの直後に挿入）"
      }
    },
    required: ["notebook_path", "source_index"]
  }
}
```

### notebook_clear_outputs

セルの出力をクリアする。

```typescript
{
  name: "notebook_clear_outputs",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "ノートブックのパス"
      },
      cell_index: {
        type: "number",
        description: "対象セルインデックス（省略時は全セルの出力をクリア）"
      }
    },
    required: ["notebook_path"]
  }
}
```

### kernel_restart

カーネルを再起動する（変数・実行状態をリセット）。

```typescript
{
  name: "kernel_restart",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      }
    },
    required: ["session_id"]
  }
}
```

### data_preview

ワークスペース内のデータファイルをプレビューする。

```typescript
{
  name: "data_preview",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: {
        type: "string",
        description: "ワークスペースID"
      },
      file_path: {
        type: "string",
        description: "ワークスペース内の相対ファイルパス（例: data/sales.csv）"
      },
      head_rows: {
        type: "number",
        description: "取得する先頭行数（デフォルト値・最大値は jupyter-mcp/src/tools/data-preview.ts を参照）"
      }
    },
    required: ["workspace_id", "file_path"]
  }
}
```

### file_read

ワークスペース内のテキストファイルの内容を取得する（ノートブック以外）。

```typescript
{
  name: "file_read",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: {
        type: "string",
        description: "ワークスペースID"
      },
      file_path: {
        type: "string",
        description: "ワークスペース内の相対ファイルパス（例: scripts/analysis.py）"
      }
    },
    required: ["workspace_id", "file_path"]
  }
}
```

## 画像ファイル管理

画像はワークスペースの `output/` ディレクトリにファイルとして永続化する。`execute_code` のテキストレスポンスにはファイルパスのみを返却し、base64データは含めない（コンテキストウィンドウ節約）。AIクライアントが画像を視覚的に確認したい場合は、`get_image` ツールで画像データを MCP の image content type として取得できる。

> 画像ファイルパス形式・対応画像形式・生成フローの詳細は `jupyter-mcp/src/tools/execute-code.ts` および `jupyter-mcp/src/tools/get-image.ts` を参照。

### get_image

`execute_code` のレスポンスに含まれる画像の `file_path` を指定して、画像データを取得する。レスポンスは MCP の image content type で返し、AIクライアントのビジョン機能で画像を分析できる。

**パラメータ:**
| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `file_path` | string | ✓ | 画像ファイルパス（`execute_code` の `images[].file_path` 値を指定） |

**レスポンス:** `jupyter-mcp/src/tools/get-image.ts` を参照。成功時は MCP image content type（base64エンコードデータ）で返却。AIクライアントはビジョン機能で画像を処理でき、base64テキストがコンテキストに展開されることはない。

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
- [ ] AI同期イベント（cell_output）にはbase64が含まれ、JupyterLab上で画像が表示される
- [ ] get_image で execute_code のレスポンスの file_path を指定し、MCP image content type で画像データが取得できる
- [ ] get_image で存在しないパスを指定した場合、適切なエラーが返される

### AC6: MCPプロトコル
- [ ] MCP Inspector で全ツールが表示される
- [ ] Claude Desktop から接続して操作できる

### AC7: カーネル共有
- [ ] ブラウザでノートブックを開き、session_connectで接続すると同じ変数空間を共有できる
- [ ] session_create(notebook_path=...)で作成したセッションに、ブラウザから接続できる
- [ ] 共有セッションでAIがコードを実行すると、ブラウザ側のノートブックに反映される

### AC8: AI編集制御
- [ ] ノートブック編集系ツール（execute_code, notebook_add_cell 等）を実行すると、自動的にノートブックがロックされる
- [ ] ツール実行完了後、自動的にロックが解除される
- [ ] ロック中にブラウザ上のセルに実行結果がリアルタイムに表示される
- [ ] ロック中にブラウザ上にセルがリアルタイムに追加される
- [ ] 新しいノートブック操作ツールを NOTEBOOK_EDIT_TOOLS に追加するだけで自動ロック制御が適用される

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
