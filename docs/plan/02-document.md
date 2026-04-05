# Document（server + mcp）

カタログ、用語集、ロジック、コンテキストエンジニアリングに関する Phase。

---

## Phase 1: カタログ・用語集・ロジック機能

PostgreSQLにCSVデータを初期ロードし、データカタログ（テーブルメタデータ）、用語集（業務用語）、既存ロジック（定型SQL/Python）をYAMLで管理。2層構造（インデックス＋詳細）でAIに提供する。3つのコンテキスト情報を統合的に扱い、AIが自律的に分析を実行できるようにする。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 1.1 | PostgreSQL環境構築 | [x] | docker-composeでPostgreSQLが起動し、CSVデータがロードされる | docker-compose追加、初期データロード |
| 1.2 | document-server: テーブルAPI実装 | [x] | GET /catalog/index でインデックス、POST /catalog/tables で詳細（一括取得）が取得できる | v2要件でAPIパス・一括取得・ディレクトリ構成変更のため差し戻し |
| 1.3 | document-server: 用語集API実装 | [x] | GET /glossary/index でインデックス、POST /glossary/terms で詳細（一括取得）が取得できる | v2要件でAPIパス変更・用語集ファイル分離のため差し戻し |
| 1.4 | document-mcp: テーブルMCPツール実装 | [x] | get_table_index, get_table_detail（table_names配列）がMCPツールとして動作する | v2要件で一括取得・APIパス変更のため差し戻し |
| 1.5 | document-mcp: 用語集MCPツール実装 | [x] | get_term_index, get_term_detail（term_names配列）がMCPツールとして動作する | 29テスト成功（既存15+新規14） |
| 1.6 | document-server: ロジックAPI実装 | [x] | GET /logic/index, POST /logic/meta, GET /logic/code/{name} が動作する | 79テスト成功（既存68+新規11） |
| 1.7 | document-mcp: ロジックMCPツール実装 | [x] | get_logic_index, get_logic_detail, get_logic_code がMCPツールとして動作する | 50テスト成功（既存29+新規21） |
| 1.8 | カタログ・用語集・ロジックの結合テスト | [x] | MCP経由でコンテキスト参照→分析コード生成→Jupyter実行の一連フローが動作する | 10テスト成功（結合9+E2E1） |

---

## Phase 2: 用語集検索機能

用語集の get_term_index に検索機能を追加する。ユーザーのプロンプトに略称や表記揺れが含まれていても、aliases を検索して正しい用語にマッチできるようにする。aliases は第2層（個別YAML）にのみ格納し、サーバー起動時に検索インデックスを構築する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 2.1 | 用語集検索機能（サーバー＋MCP） | [x] | get_term_index(query="PC") で aliases に "PC" を含む用語がヒットし、get_term_detail で詳細取得できる | document-server: GET /glossary/index に query パラメータ追加・検索インデックス構築、document-mcp: get_term_index に query パラメータ追加。document-server 89テスト、document-mcp 54テスト全パス |
| 2.2 | 用語の書き方ガイド作成 | [x] | - | docs/guides/add-term.md：aliases の書き方、各フィールドの説明 |
| 2.3 | 用語検索の related_terms 対応 | [x] | get_term_index(query="ヒルズID") で related_terms に「ヒルズID」を含む用語（例: 3Key認証）がヒットする | document-server: 検索インデックスに related_terms を追加。API レスポンス形式の変更なし |

---

## Phase 3: 外部データサポート

DBにテーブルが存在しない外部データ（テナントマスタ、カレンダーマスタ等）をカタログで管理する仕組み。カタログには定義（スキーマ情報）を保持するが、データ自体はDBに存在しない。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 3.1 | document-server: 外部データ型カタログ対応 | [x] | `data_source.type: external` のテーブル定義が `catalog/external/` から読み込まれ、テーブルインデックス・詳細APIで返却される | `catalog_loader.py` の拡張、`models.py` に external 型フィールド追加。`catalog/external/` は `DATA_DIR`（= `data/{DATA_ENV}`）配下に配置されるため、既存の環境分離（Workspace Phase 2）がそのまま適用される |

---

## Phase 4: 条件付きkey_types対応

カラムの結合キー種別（key_type）が、別カラムの値によって異なるケースに対応する。`key_types` フィールド（条件付きキー種別の配列）を追加し、`key_type`（単一）と排他的に使用できるようにする。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 4.1 | document-server: key_types 対応 | [x] | `key_types` を持つカラム定義YAMLが読み込まれ、POST /catalog/tables のレスポンスに `key_types` 配列が含まれる | models.py に ConditionalKeyType モデル追加、ColumnInfo に key_types フィールド追加、catalog_loader.py のパース処理拡張 |
| 4.2 | document-mcp: key_types 対応 | [x] | get_table_detail で `key_types` を持つカラムが正しく返却され、条件付きキー情報が確認できる | types.ts に key_types 型追加、ツール説明文更新 |
| 4.3 | 条件付きkey_typesの結合テスト | [x] | サンプルカタログに key_types 定義を追加→document-mcp 経由で取得→条件付きキー情報が正しく返却される一連フローが動作する | サンプルYAML追加、document-server + document-mcp 結合テスト |

---

## Phase 5: 柔軟な統計項目対応

データカタログの基本統計量（statistics）にテーブル固有の任意統計項目を追加できる仕組み。YAML 上では statistics セクション内に既知3フィールド（row_count, date_range, update_frequency）以外のキーを自由に記述でき、API レスポンスでは `additional` オブジェクトとして返却する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 5.1 | document-server: 柔軟な統計項目対応 | [x] | `POST /catalog/tables` で `statistics.additional` にテーブル固有の統計項目が含まれ、テーブルごとに異なる項目を返却できる | Statistics モデルに `additional: dict[str, Any]` 追加、`_parse_statistics` で既知3フィールド以外を additional に収集 |
| 5.2 | document-mcp: 柔軟な統計項目対応 | [x] | `get_table_detail` で `statistics.additional` がMCPツール経由で取得でき、AIが統計情報を正しく参照できる | Statistics インターフェースに `additional?: Record<string, unknown>` 追加 |
| 5.3 | 柔軟な統計項目の結合テスト | [x] | サンプルカタログにカスタム統計項目を追加→document-mcp 経由で取得→テーブル固有の統計情報が正しく返却される一連のフローが動作する | サンプルYAML更新、document-server + document-mcp 結合テスト |

---

## Phase 6: コンテキストエンジニアリング改善

MCPツールの description を強化し、Claude が分析フロー全体の中で各ツールを適切に使い分けられるようにする。ワークフロー指示（いつ・何の前に呼ぶか）とレスポンスフィールドの意味（JSON形式）を description に追加する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 6.1 | MCPツールの description 強化（実装） | [x] | `scripts/test.sh document-mcp` と `scripts/test.sh jupyter-mcp` が全テスト通過 | document-mcp 5ツール + jupyter-mcp 3ツールの description 更新。テキスト変更のみ、ロジック・型変更なし。複数行 description はテンプレートリテラルで実装。要件定義の description 同期は別途 `/custom-change-requirement` で対応 |
| 6.2 | MCPツールの description 強化（手動検証） | [x] | Claude Desktop で production 環境に接続し、(1) 分析前に get_logic_index が自発的に呼ばれる (2) key_type/domain で正しい JOIN が生成される (3) ツール呼び出し順序がワークフロー通りになる (4) related_terms の再帰的解決が行われる | 6.1 完了後に実施。NG の場合は原因分析と description の追加修正を行う |

---

## Phase 7: REST API 認証

document-server の REST API に認証を追加する。現在は信頼されたネットワーク前提で無認証だが、Bearer トークン認証を導入し、document-mcp からのリクエストにもトークンを付与する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 7.1 | document-server: Bearer トークン認証の実装 | [x] | 認証トークンなしのリクエストが 401 で拒否され、正しいトークン付きリクエストが成功する | jupyter-server の既存トークン認証を参考に実装 |
| 7.2 | document-mcp: 認証トークン付与 | [x] | document-mcp から document-server への全リクエストに Authorization ヘッダーが付与される | 環境変数でトークンを設定 |
| 7.3 | REST API 認証の結合テスト | [ ] | document-mcp 経由でカタログ・用語集・ロジックの取得が認証付きで正常動作する | 認証なしアクセスの拒否も確認 |
