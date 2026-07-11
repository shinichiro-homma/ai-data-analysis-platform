# プロジェクト全体像

## 目的

生成AIが自然言語の指示に基づいてデータ分析を実行できる環境を提供する。

ユーザーは「売上データを分析して傾向を教えて」のような指示を出すだけで、AIが適切なデータを特定し、分析コードを生成・実行し、結果を返却する。

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────┐
│                        生成AI (Claude等)                         │
└─────────────────────────────────────────────────────────────────┘
          │                     │
          │ MCP Protocol        │ MCP Protocol
          ▼                     ▼
┌───────────────────┐ ┌───────────────────┐
│    jupyter-mcp    │ │   document-mcp    │
│ (TypeScript MCP)  │ │ (TypeScript MCP)  │
└───────────────────┘ └───────────────────┘
                    │                           │
                    │ REST API                  │ REST API
                    ▼                           ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│      jupyter-server         │   │     document-server         │
│   (JupyterLab + Kernel)     │ (カタログ・用語集・ロジックAPI)│
│                             │   └─────────────────────────────┘
│   ┌───────────────────────┐ │                 │
│   │  jupyterlab-ai-sync   │ │                 ▼
│   │  (JupyterLab拡張)     │ │       カタログ・用語集・ロジック
│   └───────────────────────┘ │            (YAMLファイル)
│     ▲ WebSocket /api/ai/   │
│     │ events               │
└─────────────────────────────┘
                    │
                    ▼
           データベース / CSV / 外部データ
            (PostgreSQL等)      (チャットから提供)
```

**ワークスペース分離:**
```
チャットA (Claude Desktop) → jupyter-mcp → workspace_create → /workspaces/ws-001/
チャットB (Claude Desktop) → jupyter-mcp → workspace_create → /workspaces/ws-002/

各ワークスペースの内部構造:
  /workspaces/ws-001/
  ├── metadata.json       # ワークスペースメタデータ
  ├── data/               # 分析用入力データ配置場所
  ├── output/             # 分析結果出力先
  └── analysis.ipynb      # ノートブック

ノートブック・ファイルはワークスペース内に閉じ、他のチャットからは見えない。
カーネルはワークスペースディレクトリ内のみアクセス可能（スタートアップスクリプトで制限）。
ワークスペースはディスク上に永続化され、MCP再起動後も workspace_list で再発見可能。
```

**AIリアルタイム同期の仕組み:**
```
jupyter-mcp → REST API → jupyter-server → カーネル実行 → 結果をjupyter-mcpに返却
    │                                                          │
    │  POST /api/ai/events/broadcast                           │
    ├──────────────→ jupyter-server ──→ WebSocket /api/ai/events
    │                                          ↓
    │                                    jupyterlab-ai-sync拡張 → ノートブックUI更新
    │                                                              ├── セル追加
    │                                                              ├── 実行結果表示
    │                                                              └── ロック/アンロック
    └→ AI: 結果返却
```

## 典型的なユースケースフロー

### 既存ノートブックでの共同作業（ユーザー先行）

```
ユーザー: ブラウザでノートブックを開いてデータ読み込み済み

生成AI: session_connect でユーザーのセッションに接続
    │   → 同じカーネル/変数空間を共有
    │
生成AI: get_variables で現在の変数を確認
    │
生成AI: execute_code で追加分析を実行
    │   → ユーザーが読み込んだデータをそのまま利用可能
```

### AIが先行してセッション準備（AI先行）

```
生成AI: workspace_create(name="売上分析") でワークスペース作成
    │   → 独立した作業ディレクトリを確保（data/, output/ サブディレクトリ自動作成）
    │
生成AI: session_create(workspace_id=..., notebook_path="analysis.ipynb") でセッション作成
    │   → カーネル起動、ワークスペース内にノートブック作成
    │   → カーネルはワークスペース内のみアクセス可能
    │
ユーザー: ブラウザで analysis.ipynb を開く
    │   → AIが起動したカーネルに自動接続
    │
生成AI: notebook_add_cell + execute_code でデータ読み込み・前処理
    │   → 自動ロック → セル追加・実行結果がブラウザにリアルタイム反映 → 自動アンロック
```

### データ分析リクエスト

```
ユーザー: 「先月の売上データを分析して、地域別の傾向を教えて」

【Phase 1：用語理解】
    │
    ▼
生成AI: document-mcp の get_term_index で用語一覧を取得
    │   → 不明な業務用語があれば get_term_detail で再帰的に理解
    │
【Phase 2：データカタログ参照】
    │
    ▼
生成AI: document-mcp の get_table_index で全テーブルインデックスを取得
    │   → 軽量なインデックスでどのテーブルを使うか判断
    │   → "purchase_history", "customer_master" が必要と判断
    │
    ▼
生成AI: document-mcp の get_table_detail(["purchase_history", "customer_master"])
    │   → カラム定義（key_type/key_types, domain）、基本統計量、注意点を確認
    │   → key_type/key_types でテーブル結合のキーを判断（key_typesは条件付き）
    │
【Phase 3：既存ロジック参照（AIが必要と判断した場合）】
    │
    ▼
生成AI: document-mcp の get_logic_index で既存ロジック一覧を取得
    │   → 使えそうなロジックがあれば get_logic_detail で詳細取得
    │   → 必要に応じて get_logic_code でコード取得
    │
【Phase 4：分析環境準備】
    │
    ▼
生成AI: jupyter-mcp の workspace_create でワークスペース作成
    │   → チャット専用の作業空間を確保（data/, output/ 付き）
    │
    ▼
生成AI: jupyter-mcp の session_create(workspace_id=...) でセッション作成
    │
【Phase 5：データ取得】
    │
    ├── (DB型・データセット作成) カタログ情報を基にSQLクエリを生成
    │   → export_sql(sql, filename) でデータセットをエクスポート
    │   → 結果がワークスペースの data/ にParquetとして保存される
    │
    ├── (DB型・集計・確認) カタログ情報を基にSQLクエリを生成
    │   → execute_sql(sql, filename) でクエリ実行
    │   → 結果がワークスペースの data/ にCSVとして保存される
    │
    │
【Phase 6：分析コード実行】
    │
    ▼
生成AI: execute_code で pd.read_csv('data/...') でデータ読み込み・分析
    │   → グラフ描画 + 数値データ出力
    │
    ▼
生成AI: 実行結果を解釈してユーザーに回答
```

### データカタログ・用語集・ロジックの準備（PoC）

```
管理者: YAMLファイルでカタログ・用語集・ロジックを作成
    │
    │   データは環境別ディレクトリで管理（DATA_ENV で切り替え）
    │   ├── data/sample/   ... サンプルデータ（動作確認・検証用、git管理）
    │   └── data/production/ ... 本番データ（実運用データ、git管理外）
    │
    ├── data/{DATA_ENV}/catalog/（テーブル定義）
    │   ├── index.yaml
    │   ├── tables/
    │   │   ├── purchase_history.yaml
    │   │   ├── product_master.yaml
    │   │   └── customer_master.yaml
    │
    ├── data/{DATA_ENV}/glossary/（用語集）
    │   ├── index.yaml
    │   └── terms/
    │       ├── ロイヤルティランク.yaml
    │       └── 統合会員ID.yaml
    │
    └── data/{DATA_ENV}/logic/（既存ロジック）
        ├── index.yaml
        ├── meta/
        │   └── member_id_remapping.yaml
        └── code/
            └── sql/
                └── member_id_remapping.sql
    │
    ▼
scripts/generate-init-scripts.sh: カタログYAMLからPostgreSQL初期化スクリプトを自動生成
    │   ├── postgres/init/sample/       ... サンプル用（git管理）
    │   └── postgres/init/production/   ... 本番用（git管理外）
    │       ├── create-tables.sql       ... CREATE TABLE文（カラム名・型はカタログYAMLから生成）
    │       └── load-data.py            ... Parquet→COPY FROM STDINでロード（ホスト側から実行）
    │
    ▼
document-server: 起動時に DATA_ENV で指定された環境のYAMLを読み込み、APIを提供
jupyter-server: DATA_ENV に応じてワークスペースルートを切り替え
postgres: DATA_ENV に応じて環境別の初期化スクリプトを実行
    │   ├── workspaces/sample/   ... サンプル環境のワークスペース
    │   └── workspaces/production/ ... 本番環境のワークスペース
```

## コンポーネント詳細

### jupyter-server

JupyterLabをベースとした分析実行環境。

**責務:**
- Pythonカーネルの管理
- ノートブックの永続化
- コード実行と結果の返却
- SQL実行とCSVファイルへの保存（execute_sql: 集計・確認用）
- SQLデータエクスポート（export_sql: データセット作成・保存用、Parquet/CSV、ストリーミング書き出し）
- AI操作イベントのWebSocket配信
- ワークスペースサマリ生成用テンプレート・評価基準の提供

> 技術スタック・API一覧は [requirements/jupyter-server.md](requirements/jupyter-server.md)、[api-contracts.md](design/api-contracts.md) を参照。

### jupyter-mcp

生成AIがJupyter環境を操作するためのMCPサーバー。

**責務:**
- ワークスペース管理（チャットごとの独立した作業空間）
- セッション管理（カーネル起動/停止）
- コード実行リクエストの中継
- 実行結果・画像の返却

**画像管理:**
- 画像はワークスペースの `output/` ディレクトリにファイルとして保存（jupyter-server 側で保存）
- `execute_code` のレスポンスにはファイルパス（ワークスペース相対）、MIME type、説明のみを返却（base64データは含めない）
- AIクライアントが画像を視覚的に確認したい場合は、`get_image` ツールで MCP image content type として取得
- 画像の実データはJupyterLab UIでも確認可能

> 技術スタック・MCPツール一覧は [requirements/jupyter-mcp.md](requirements/jupyter-mcp.md) を参照。

### jupyterlab-ai-sync

JupyterLabのフロントエンド拡張。AIの操作をノートブック上でリアルタイム表示し、AI編集中のロック制御を行う。

**責務:**
- AI操作イベントの受信（WebSocket）
- ノートブックUIのリアルタイム更新（セル追加、実行結果表示）
- AI編集中のノートブックロック/アンロック制御
- ファイルブラウザUI改善（シングルクリックでフォルダツリー展開、ダブルクリックでフォルダ移動）

> 技術スタック・受信イベント一覧は [requirements/jupyterlab-ai-sync.md](requirements/jupyterlab-ai-sync.md) を参照。

### document-server

事前作成されたデータカタログ、用語集、既存ロジックを読み込み、APIを提供するサーバー。

**責務:**
- YAMLファイル（テーブル定義・用語集・ロジック）の読み込み
- テーブルインデックス・詳細API
- 用語インデックス・詳細API
- ロジックインデックス・メタ・コードAPI

> 技術スタック・API一覧は [requirements/document-server.md](requirements/document-server.md)、[api-contracts.md](design/api-contracts.md) を参照。

### document-mcp

生成AIがデータカタログ、用語集、既存ロジックを参照するためのMCPサーバー。
2層構造（インデックス＋詳細）でコンテキストを効率的に使用する。

**責務:**
- テーブルインデックス・詳細の提供
- 用語インデックス・詳細の提供
- ロジックインデックス・詳細・コードの提供

> 技術スタック・MCPツール一覧は [requirements/document-mcp.md](requirements/document-mcp.md) を参照。

## データフロー

### 分析実行時のデータフロー

```
【Phase 1：用語理解】
1. AI → document-mcp: get_term_index(query="略称") で検索（略称・不明用語がある場合）
   または get_term_index() で全件取得（全体像把握）
2. document-mcp → document-server: GET /glossary/index?query=略称
3. document-server: name + aliases + related_terms（第2層で管理）を部分一致検索
4. document-mcp → AI: ヒットした用語インデックス

5. AI → document-mcp: get_term_detail(["ロイヤルティランク", "統合会員ID"])
6. document-mcp → document-server: POST /glossary/terms
7. AI: 不明な業務用語があればさらに get_term_detail で再帰的に解決

【Phase 2：カタログ参照】
8. AI → document-mcp: get_table_index()
9. document-mcp → document-server: GET /catalog/index
10. document-server → document-mcp: 全テーブルインデックス
11. document-mcp → AI: テーブルインデックス

12. AI: 使用するテーブルを判断

13. AI → document-mcp: get_table_detail(["purchase_history", "customer_master"])
14. document-mcp → document-server: POST /catalog/tables
15. document-server → document-mcp: テーブル詳細
16. document-mcp → AI: 基本情報、カラム定義（key_type/key_types, domain）、基本統計量、注意点

【Phase 3：既存ロジック参照（必要時）】
17. AI → document-mcp: get_logic_index()
18. document-mcp → document-server: GET /logic/index
19. AI → document-mcp: get_logic_detail(["member_id_remapping"])
20. AI → document-mcp: get_logic_code("member_id_remapping")

【Phase 4：分析環境準備】
21. AI → jupyter-mcp: workspace_create(name="売上分析")
22. jupyter-mcp → jupyter-server: POST /api/workspaces
23. jupyter-server: ワークスペースディレクトリ作成（data/, output/ 含む）
24. jupyter-mcp → AI: ワークスペースID、data_path、output_path

25. AI → jupyter-mcp: session_create(workspace_id=...)
26. jupyter-mcp → jupyter-server: POST /api/kernels
27. jupyter-server → jupyter-mcp: カーネルID
28. jupyter-mcp → AI: セッションID

【Phase 5：データ取得】

■ パターンA-1：DBからデータ取得・確認（集計・少量データ）
29. AI: カタログ情報を基にSQLクエリを生成
30. AI → jupyter-mcp: execute_sql(session_id, sql, filename)
31. jupyter-mcp → jupyter-server: POST /api/sql/execute
32. jupyter-server: DB接続 → SQL実行 → CSV保存（data/ディレクトリ）
33. jupyter-server → jupyter-mcp: メタデータ（行数、カラム、ファイルパス）
34. jupyter-mcp → AI: 保存結果

■ パターンA-2：DBからデータセット作成・保存（大量データ）
29. AI: カタログ情報を基にSQLクエリを生成
30. AI → jupyter-mcp: export_sql(session_id, sql, filename, format, timeout)
31. jupyter-mcp → jupyter-server: POST /api/sql/export
32. jupyter-server: DB接続 → SQL実行 → チャンク処理（10,000行ずつ）→ Parquet/CSV ストリーミング書き出し
33. jupyter-server → jupyter-mcp: メタデータ（row_count, file_size_bytes, file_path）
34. jupyter-mcp → AI: 保存結果

【Phase 6：分析コード実行】
35. AI → jupyter-mcp: execute_code(session_id, "pd.read_csv('data/...')")
36. jupyter-mcp → jupyter-server: POST /api/kernels/{id}/execute
37. jupyter-server: コード実行（データ読み込み・分析・グラフ生成）
38. jupyter-server: 画像出力を検出 → ワークスペースの output/ にファイルとして保存
39. jupyter-server → jupyter-mcp: 実行結果 + 画像ファイルパス（base64データなし）
40. jupyter-mcp → AI: 結果 + 画像参照情報（file_path, mime_type, description）

41. AI: 画像生成の有無・枚数・保存先を把握、数値データと合わせて回答
    （画像の実データはJupyterLab UIでユーザーが確認）
```

### AIリアルタイム同期のデータフロー

ユーザーがブラウザでノートブックを開いている状態で、AIが操作する場合のフロー。
handleToolCall ミドルウェアがノートブック編集系ツールの実行前後に自動でロック制御を行う。

```
【セル追加 + リアルタイム反映】（ミドルウェアが自動ロック制御）
1. AI → jupyter-mcp: notebook_add_cell(notebook_path, cell_type, source, ...)
2. jupyter-mcp ミドルウェア → jupyter-server: POST /api/ai/locks（ロック取得、lock_token を受領）
3. jupyter-server → jupyterlab-ai-sync: lock_acquired 配信 → ノートブックをロック（read-only化）
4. jupyter-mcp → jupyter-server: PATCH /api/custom/contents/{path}/cells（X-Lock-Token 付き）
5. jupyter-mcp → jupyter-server: POST /api/ai/events/broadcast {type: "cell_added"}
6. jupyterlab-ai-sync: ノートブックUIにセルを挿入
7. jupyter-mcp ミドルウェア → jupyter-server: DELETE /api/ai/locks（ロック解放）
8. jupyter-server → jupyterlab-ai-sync: lock_released 配信 → ノートブックのロック解除

【コード実行 + リアルタイム反映】（ミドルウェアが自動ロック制御）
9. AI → jupyter-mcp: execute_code(session_id, code)
10. jupyter-mcp ミドルウェア → jupyter-server: POST /api/ai/locks（session からノートブックを解決してロック取得）
11. jupyter-server → jupyterlab-ai-sync: lock_acquired 配信 → ノートブックをロック（read-only化）
12. jupyter-mcp → jupyter-server: POST /api/ai/events/broadcast {type: "cell_execute_start"}
13. jupyter-mcp → jupyter-server: POST /api/kernels/{id}/execute
14. jupyter-server: カーネル実行 → 実行結果を jupyter-mcp に返却
15. jupyter-mcp: 出力ごとに → POST /api/ai/events/broadcast {type: "cell_output"}
16. jupyterlab-ai-sync: セルに出力を表示
17. jupyter-mcp → jupyter-server: POST /api/ai/events/broadcast {type: "cell_execute_end"}
18. jupyter-mcp → AI: 結果 + 画像ファイルパス（base64データなし）
19. jupyter-mcp ミドルウェア → jupyter-server: DELETE /api/ai/locks（ロック解放）
20. jupyter-server → jupyterlab-ai-sync: lock_released 配信 → ノートブックのロック解除

※ ロックの書き込み強制はサーバー側（contents_manager.save のラップ）が担う。長時間実行中は
   ミドルウェアが PUT /api/ai/locks（20秒間隔）で TTL を延長し、解放に失敗しても TTL 失効時に
   lock_released が配信されるため固着しない。
```

## 画像認識とデータ取得の使い分け

生成AIの画像認識には特性があるため、グラフと数値データを併用する。

| 目的 | 方法 |
|------|------|
| 全体的なトレンド確認 | グラフを見る |
| 異常値・外れ値の発見 | グラフを見る |
| カテゴリ間の大小比較 | グラフを見る |
| 特定時点の正確な値 | 数値データを出力 |
| 集計値（合計、平均等） | 数値データを出力 |

**推奨パターン:**
```python
# グラフで傾向を可視化
plt.plot(df['date'], df['sales'])
plt.show()

# 具体的な数値も出力（AIが正確に読める）
print(f"最大: {df['sales'].max():,.0f}")
print(f"最小: {df['sales'].min():,.0f}")
print(df[['date', 'sales']].to_string())
```

## 非機能要件

### セキュリティ
- jupyter-serverは信頼されたネットワーク内でのみ公開
- DB接続情報は環境変数で管理
- シェルコマンド実行の多層防御（詳細は [jupyter-server 要件定義](requirements/jupyter-server.md) NF2.1 参照）

### パフォーマンス
- コード実行のタイムアウト設定（デフォルト30秒）
- 大量データ出力の制限（最大1MB）
- カタログ概要取得でコンテキストを節約

### 可用性
- 各コンポーネントは独立してデプロイ可能
- カーネルクラッシュ時の自動復旧

## 開発プラン

開発タスクの管理は [docs/plan/README.md](plan/README.md) を参照。

## 参考リンク

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html)
