# jupyter-mcp 要件定義

## 概要

生成AIがJupyter環境を操作するためのMCPサーバー。jupyter-serverのREST APIをラップし、MCPツールとして提供する。

## 機能要件

### F1: セッション管理

#### F1.1: セッション作成
- 新しい分析セッションを作成できる
- セッション作成時にカーネルが自動起動する
- セッションIDを返却する

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

### F2: コード実行

#### F2.1: コード実行（同期）
- Pythonコードを実行し、結果を返却する
- 実行結果には以下を含む:
  - stdout/stderr
  - 戻り値（表示可能な形式）
  - 画像出力（base64）
  - 実行時間

#### F2.2: コード実行（セル単位）
- ノートブックの特定セルを実行できる
- セルインデックスまたはセルIDで指定

#### F2.3: 実行中断
- 実行中のコードを中断できる

### F3: ノートブック操作

#### F3.1: ノートブック作成
- 新規ノートブックを作成
- オプションで初期セルを設定可能

#### F3.2: セル操作
- セルの追加（code/markdown）
- セルの編集
- セルの削除
- セルの並び替え

#### F3.3: ノートブック取得
- ノートブックの内容を取得
- 全セルのソースと出力を含む

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

#### F4.3: データプレビュー
- ファイルパスを指定してデータをプレビュー
- CSV, Excel, Parquet等に対応

### F5: ファイル操作

#### F5.1: ファイル一覧
- ワークスペース内のファイル一覧を取得

#### F5.2: ファイル読み取り
- テキストファイルの内容を取得

#### F5.3: 出力ファイル取得
- 分析で生成されたファイルを取得

### F6: 画像出力（MCPリソース）

#### F6.1: 実行結果の画像取得
- コード実行で生成された画像をMCPリソースとして提供
- matplotlib, seaborn, plotly等の出力に対応
- 生成AIクライアントが画像を直接認識できる形式で返却

#### F6.2: 画像リソース一覧
- セッション内で生成された画像の一覧を取得
- 各画像にはユニークなリソースURIを付与

#### F6.3: 画像リソース取得
- リソースURIを指定して画像データを取得
- base64エンコードされた画像データとMIMEタイプを返却

## MCPツール定義

### session_create

新しい分析セッションを作成する。

```typescript
{
  name: "session_create",
  description: "新しいデータ分析セッションを作成します。コード実行前に必ず呼び出してください。",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "セッション名（オプション）"
      },
      notebook_path: {
        type: "string",
        description: "関連付けるノートブックのパス。指定するとユーザーがそのノートブックを開いたときに同じカーネルを共有できる"
      }
    }
  }
}
```

**戻り値:**
```json
{
  "session_id": "abc123",
  "kernel_id": "kernel-xyz",
  "status": "idle",
  "created_at": "2024-01-15T10:00:00Z"
}
```

### session_list

アクティブなセッション一覧を取得する。

```typescript
{
  name: "session_list",
  description: "アクティブな分析セッションの一覧を取得します。",
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
  description: "既存のセッションに接続します。ブラウザで開いているノートブックと同じカーネルを使用できます。",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "接続するノートブックのパス"
      },
      kernel_id: {
        type: "string",
        description: "接続するカーネルID（notebook_pathの代わりに指定可能）"
      }
    }
  }
}
```

**戻り値:**
```json
{
  "session_id": "abc123",
  "kernel_id": "kernel-xyz",
  "notebook_path": "Untitled.ipynb",
  "status": "idle",
  "connected": true
}
```

**エラー時（セッションが見つからない場合）:**
```json
{
  "error": "session_not_found",
  "message": "指定されたノートブックに関連するセッションが見つかりません"
}
```

### session_delete

セッションを終了する。

```typescript
{
  name: "session_delete",
  description: "分析セッションを終了し、リソースを解放します。",
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
  description: "Pythonコードを実行し、結果を返します。事前にsession_createでセッションを作成してください。",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      code: {
        type: "string",
        description: "実行するPythonコード"
      },
      timeout: {
        type: "number",
        description: "タイムアウト秒数（デフォルト30秒）"
      }
    },
    required: ["session_id", "code"]
  }
}
```

**戻り値:**
```json
{
  "success": true,
  "stdout": "Hello, World!\n",
  "stderr": "",
  "result": null,
  "images": [
    {
      "resource_uri": "jupyter://session-abc123/images/output-001.png",
      "mime_type": "image/png",
      "description": "matplotlib output [1]"
    }
  ],
  "execution_time_ms": 15
}
```

**エラー時:**
```json
{
  "success": false,
  "error_type": "ZeroDivisionError",
  "error_message": "division by zero",
  "traceback": "..."
}
```

### get_variables

定義済み変数の一覧を取得する。

```typescript
{
  name: "get_variables",
  description: "セッション内で定義されている変数の一覧を取得します。",
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

**戻り値:**
```json
{
  "variables": [
    {"name": "df", "type": "DataFrame", "size": "1000 rows × 5 cols"},
    {"name": "x", "type": "int", "value": 42},
    {"name": "model", "type": "LinearRegression", "size": "..."}
  ]
}
```

### get_dataframe_info

DataFrameの詳細情報を取得する。

```typescript
{
  name: "get_dataframe_info",
  description: "DataFrameの構造と統計情報を取得します。",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      variable_name: {
        type: "string",
        description: "DataFrame変数名"
      },
      include_head: {
        type: "boolean",
        description: "先頭行を含めるか（デフォルトtrue）"
      },
      head_rows: {
        type: "number",
        description: "先頭何行を取得するか（デフォルト5）"
      }
    },
    required: ["session_id", "variable_name"]
  }
}
```

**戻り値:**
```json
{
  "shape": [1000, 5],
  "columns": ["id", "name", "value", "date", "category"],
  "dtypes": {
    "id": "int64",
    "name": "object",
    "value": "float64",
    "date": "datetime64[ns]",
    "category": "category"
  },
  "head": [
    {"id": 1, "name": "A", "value": 100.5, "date": "2024-01-01", "category": "X"},
    ...
  ],
  "describe": {
    "value": {"count": 1000, "mean": 150.3, "std": 45.2, "min": 10.0, "max": 300.0}
  }
}
```

### notebook_create

新規ノートブックを作成する。

```typescript
{
  name: "notebook_create",
  description: "新しいノートブックを作成します。",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      name: {
        type: "string",
        description: "ノートブック名（拡張子不要）"
      }
    },
    required: ["session_id", "name"]
  }
}
```

### notebook_add_cell

ノートブックにセルを追加する。

```typescript
{
  name: "notebook_add_cell",
  description: "ノートブックに新しいセルを追加します。",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      notebook_name: {
        type: "string",
        description: "ノートブック名"
      },
      cell_type: {
        type: "string",
        enum: ["code", "markdown"],
        description: "セルの種類"
      },
      source: {
        type: "string",
        description: "セルの内容"
      },
      position: {
        type: "number",
        description: "挿入位置（省略時は末尾）"
      }
    },
    required: ["session_id", "notebook_name", "cell_type", "source"]
  }
}
```

### file_list

ファイル一覧を取得する。

```typescript
{
  name: "file_list",
  description: "ワークスペース内のファイル一覧を取得します。",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "セッションID"
      },
      path: {
        type: "string",
        description: "ディレクトリパス（省略時はルート）"
      }
    },
    required: ["session_id"]
  }
}
```

## MCPリソース定義

MCPリソースを使用して、生成AIクライアントが画像を直接認識できるようにする。

### リソースURI形式

```
jupyter://sessions/{session_id}/images/{image_id}.{ext}
```

例: `jupyter://sessions/abc123/images/output-001.png`

### リソース一覧（resources/list）

セッション内で生成された画像リソースの一覧を返却。

**レスポンス:**
```json
{
  "resources": [
    {
      "uri": "jupyter://sessions/abc123/images/output-001.png",
      "name": "matplotlib output [1]",
      "mimeType": "image/png",
      "description": "Cell [3]: plt.plot() output"
    },
    {
      "uri": "jupyter://sessions/abc123/images/output-002.png",
      "name": "seaborn heatmap",
      "mimeType": "image/png",
      "description": "Cell [5]: sns.heatmap() output"
    }
  ]
}
```

### リソース取得（resources/read）

指定URIの画像データを返却。

**リクエスト:**
```json
{
  "uri": "jupyter://sessions/abc123/images/output-001.png"
}
```

**レスポンス:**
```json
{
  "contents": [
    {
      "uri": "jupyter://sessions/abc123/images/output-001.png",
      "mimeType": "image/png",
      "blob": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

### 対応画像形式

| 形式 | MIMEタイプ | 用途 |
|------|-----------|------|
| PNG | image/png | matplotlib, seaborn等の標準出力 |
| JPEG | image/jpeg | 写真データの出力 |
| SVG | image/svg+xml | ベクター形式（plotly等） |

### 画像生成からリソース登録までのフロー

```
1. execute_code でグラフ描画コードを実行
2. jupyter-server が画像出力を検出
3. jupyter-mcp が画像をbase64で受け取り
4. 一意のリソースURIを生成して内部ストレージに保存
5. execute_code のレスポンスに resource_uri を含めて返却
6. AIクライアントが resources/read で画像を取得・認識
```

### get_image_resource ツール（補助）

リソースURIから画像を取得するヘルパーツール。AIがリソースAPIを直接呼べない場合に使用。

```typescript
{
  name: "get_image_resource",
  description: "生成された画像をbase64形式で取得します。execute_codeの結果に含まれるresource_uriを指定してください。",
  inputSchema: {
    type: "object",
    properties: {
      resource_uri: {
        type: "string",
        description: "画像のリソースURI（例: jupyter://sessions/abc123/images/output-001.png）"
      }
    },
    required: ["resource_uri"]
  }
}
```

**戻り値:**
```json
{
  "mime_type": "image/png",
  "data": "iVBORw0KGgoAAAANSUhEUgAA...",
  "width": 800,
  "height": 600
}
```

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

- 全ツール呼び出しをログ出力
- 実行コードは機密情報を含む可能性があるため、オプションで非記録

## 技術仕様

### 技術スタック

- TypeScript
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- axios または fetch（HTTP クライアント）

### ディレクトリ構成

```
jupyter-mcp/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # エントリーポイント
│   ├── server.ts             # MCPサーバー定義
│   ├── tools/                # ツール実装
│   │   ├── session.ts
│   │   ├── execute.ts
│   │   ├── notebook.ts
│   │   ├── variables.ts
│   │   └── files.ts
│   ├── jupyter-client/       # Jupyter API クライアント
│   │   ├── client.ts
│   │   ├── types.ts
│   │   └── errors.ts
│   └── utils/
│       └── output-formatter.ts
└── tests/
    └── ...
```

### 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `JUPYTER_SERVER_URL` | jupyter-serverのURL | http://localhost:8888 |
| `JUPYTER_TOKEN` | 認証トークン | （必須） |
| `MCP_PORT` | MCPサーバーポート | 3001 |
| `LOG_LEVEL` | ログレベル | info |

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
- [ ] session_list で作成したセッションが表示される
- [ ] session_delete でセッションが削除される

### AC2: コード実行
- [ ] execute_code で `print("hello")` を実行し、stdoutに"hello"が返る
- [ ] execute_code でエラーを起こすコードを実行し、エラー情報が返る
- [ ] execute_code でmatplotlibグラフを作成し、画像が返る
- [ ] タイムアウト設定が機能する

### AC3: 変数操作
- [ ] get_variables で定義済み変数一覧が取得できる
- [ ] get_dataframe_info でDataFrameの詳細が取得できる

### AC4: ノートブック操作
- [ ] notebook_create でノートブックが作成される
- [ ] notebook_add_cell でセルが追加される

### AC5: 画像リソース
- [ ] matplotlibでグラフを描画すると、execute_codeの結果にresource_uriが含まれる
- [ ] resources/list でセッション内の画像一覧が取得できる
- [ ] resources/read で画像のbase64データが取得できる
- [ ] get_image_resource ツールで画像データが取得できる
- [ ] Claude等のAIクライアントが画像を認識して内容を説明できる

### AC6: MCPプロトコル
- [ ] MCP Inspector で全ツールが表示される
- [ ] Claude Desktop から接続して操作できる

### AC7: カーネル共有
- [ ] ブラウザでノートブックを開き、session_connectで接続すると同じ変数空間を共有できる
- [ ] session_create(notebook_path=...)で作成したセッションに、ブラウザから接続できる
- [ ] 共有セッションでAIがコードを実行すると、ブラウザ側のノートブックに反映される

## 依存関係

- jupyter-server が起動していること

## AIエージェント向けの使用ガイドライン

このMCPサーバーを使用するAIエージェントは、以下のパターンでツールを使用することを推奨:

### 基本的な分析フロー

```
1. session_create でセッションを作成
2. execute_code でデータ読み込み
3. get_variables / get_dataframe_info でデータ構造を確認
4. execute_code で分析コードを実行
5. 必要に応じて notebook_add_cell で記録
6. 分析完了後、session_delete でクリーンアップ
```

### 可視化を含むフロー

```
1. session_create でセッションを作成
2. execute_code でデータ読み込み・可視化コード実行
3. レスポンスの images 配列から resource_uri を取得
4. get_image_resource または resources/read で画像データ取得
5. 画像を認識して分析結果を説明
```

### 画像認識のベストプラクティス

- 可視化コードを実行したら、必ず画像リソースを取得して内容を確認する
- 複数のグラフを生成した場合は、それぞれの画像を取得して説明する
- 画像の内容とコードの意図を照らし合わせて、正しく描画されているか確認する

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
