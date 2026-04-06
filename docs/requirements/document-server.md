# document-server 要件定義

## 概要

事前に作成されたデータカタログ、用語集、既存ロジックを読み込み、APIを提供するサーバー。生成AIが適切なデータソースを特定し、業務用語を理解し、既存の分析ロジックを活用できるようにする。

## 前提条件

- データカタログは事前にYAMLファイルとして作成済み
- 用語集は事前にYAMLファイルとして作成済み
- 既存ロジックのメタ情報はYAMLファイル、コード本体は別ファイル（.sql/.py）として作成済み
- PoCフェーズではPostgreSQLにCSVデータを初期ロードして使用（data_sourceはpostgresql/csv両対応）
- サンプルデータと本番データを環境変数 `DATA_ENV` で切り替え可能（デフォルト: `sample`）
- データファイルは環境別ディレクトリ（`data/sample/`, `data/production/`）で管理
- 本番データは `.gitignore` で管理外とし、手動配置する
- 外部テーブル定義（`catalog/external/*.yaml`）は `index.yaml` を経由せず、ディレクトリ配下のYAMLファイルを直接パースして読み込む
- カタログ・用語集・ロジックの動的な登録・更新機能は不要

## 用語定義

| 用語 | 説明 |
|------|------|
| テーブル | データの単位。既存DBのテーブルやビュー、または外部データの定義 |
| カラム | テーブル内のフィールド/列 |
| カテゴリ | テーブルの分類（マスタ系 / トランザクション系 / アプリ系 / 施設利用系 / 外部マスタ系 等。外部データは「外部マスタ系」カテゴリで管理） |
| 外部データ | DBにテーブルが存在しないが、カタログに定義（スキーマ情報）を保持するデータ。テナントマスタやカレンダーマスタなど、フォーマットが固定で都度チャットから提供されるデータ |
| カタログファイル | テーブル情報を記述したYAMLファイル |
| 用語 | 組織固有の業務用語 |
| 用語集ファイル | 用語情報を記述したYAMLファイル |
| key_type | カラムの結合キー種別。用語集の業務用語と整合させる識別子。単一の場合に使用 |
| key_types | 条件付き結合キー種別。別カラムの値によってキー種別が異なる場合に使用。各要素に `value`（キー種別）は必須、`condition`（条件）はオプション。`key_type` と排他（両方指定不可） |
| domain | カラムの取りうる値の定義（マスタ参照型 or 直接列挙型） |
| ロジック | 組織内で標準化された分析ロジック（SQL/Pythonスクリプト） |
| usage_type | ロジックの利用方法（template: パラメータ変更で再利用 / reference: 参考にして新規作成） |

## 機能要件

### F1: カタログ・用語集・ロジックの読み込み

#### F1.1: 起動時読み込み
- 指定ディレクトリからカタログファイル、用語集ファイル、ロジックファイルを読み込む
- YAML形式に対応
- 複数ファイルの読み込みに対応

#### F1.2: リロード
- API経由でカタログ・用語集・ロジックを再読み込みできる
- ファイル変更時にサーバー再起動不要

### F2: テーブル情報取得

#### F2.1: テーブルインデックス
- 登録済みテーブルのインデックスを取得
- table_name, display_name, summary, category を返却

#### F2.2: テーブル詳細（一括対応）
- 指定テーブル（複数指定可、上限は `src/models.py` の `BULK_REQUEST_MAX` を参照）の詳細情報を取得
- 5セクション構成: 基本情報、データソース、カラム定義、基本統計量（テーブル固有の拡張統計項目を含む）、テーブルレベル注意点
- カラム定義にはkey_type（またはkey_types）, domain, notes, examplesを含む（定義されている場合）
- key_typesは条件付きキー種別で、別カラムの値によってキー種別が異なる場合に使用する
- data_sourceフィールドでデータの格納先情報を提供（postgresql / csv / external の3パターン）
- external型の場合、DBにテーブルは存在せず、カタログ定義（スキーマ情報）のみを保持する

### F3: 用語情報取得

#### F3.1: 用語インデックス
- 登録済み用語のインデックスを取得
- name, summary を返却
- オプションの query パラメータ（上限は `src/routers/terms.py` の `max_length` を参照）で用語名（name）、別名（aliases、第2層で管理）、および関連用語（related_terms、第2層で管理）を部分一致検索できる
- query 指定時はヒットした用語のみ返却、省略時は全件返却
- 起動時に全用語詳細から aliases および related_terms を読み込み、インメモリの検索インデックスを構築する

#### F3.2: 用語詳細（一括対応）
- 指定用語（複数指定可、上限は `src/models.py` の `BULK_REQUEST_MAX` を参照）の詳細情報を取得
- name, aliases, definition, related_terms, values を返却

### F4: ロジック情報取得

#### F4.1: ロジックインデックス
- 登録済みロジックのインデックスを取得
- logic_name, summary, category を返却

#### F4.2: ロジックメタ（一括対応）
- 指定ロジック（複数指定可、上限は `src/models.py` の `BULK_REQUEST_MAX` を参照）のメタ情報を取得
- description, file_path, language, usage_type, input_tables, output_description, usage_context, related_logic, notes を返却

#### F4.3: ロジックコード
- 指定ロジックのコードファイルの中身を取得
- logic_name のバリデーション（許可文字パターン・最大長）は `src/routers/logic.py` のパスパラメータ定義を参照
- logic_name, language, code を返却

### F5: 管理機能

#### F5.1: リロード
- カタログ・用語集・ロジックを再読み込み

#### F5.2: ヘルスチェック
- サーバーの稼働状態を確認

## データ格納形式・ファイル構成

### 格納形式

YAMLファイルベースで管理する。

**選定理由：**
- 人間が読み書きしやすく、分析チームがテキストエディタで直接編集・レビュー可能
- Git管理との相性が良い（差分が見やすい）
- document-serverのAPI層で抽象化するため、将来的にDB移行が必要になった場合もMCP側の変更は不要

### ファイル構成

> `document-server/data/` 配下のディレクトリ構成は実際のファイルシステムを参照。sample/ はgit管理、production/ はgit管理外（手動配置）。各データセットは glossary/、catalog/、logic/ の3カテゴリで構成される。

## カタログファイル形式

### テーブルインデックス（index.yaml）

テーブルインデックスは専用の index.yaml で管理する。

```yaml
tables_index:
  - table_name: "purchase_history"
    display_name: "購買履歴（ID-POS）"
    summary: "統合会員の購買トランザクションデータ。1レコード＝1購買明細。"
    category: "トランザクション系"
  - table_name: "customer_master"
    display_name: "会員マスタ"
    summary: "統合会員の基本情報を管理するマスタテーブル。"
    category: "マスタ系"
```

### テーブル詳細定義（例: purchase_history.yaml）

```yaml
table_name: purchase_history
display_name: 購買履歴（ID-POS）
description: |
  統合会員の購買トランザクションデータ。
  各レコードが1購買明細（1商品）に対応する。
  明細レベルの分析や、独自の集計軸での集計が必要な場合に使用する。
data_source:
  type: postgresql
  table: purchase_history

columns:
  - name: customer_id
    type: varchar(16)
    description: "統合顧客ID（洗い替え後）"
    nullable: false
    key_type: "統合会員番号"
    domain:
      master_table: customer_master
      master_column: customer_id
      label_column: customer_name
    notes: |
      洗い替え後のIDを使用。洗い替え前のIDはraw_customer_idカラム。
      会員マスタとの結合にはこのカラムを使うこと。
    examples: ["MB00012345", "MB00067890"]

  - name: member_code
    type: varchar(20)
    description: "会員コード（会員種別に応じて体系が異なる）"
    nullable: false
    key_types:
      - value: "統合会員番号"
        condition: "member_type = '正会員'"
      - value: "仮会員番号"
        condition: "member_type = '仮会員'"
    notes: |
      member_type カラムの値により、会員コード体系が異なる。
      正会員の場合は統合会員番号、仮会員の場合は仮会員番号として扱う。

  - name: amount
    type: integer
    description: "購買金額（税抜）"
    nullable: false
    notes: |
      税抜金額。キャンセル済み取引もレコードとして残っているため、
      売上集計時は status != 'cancelled' でフィルタすること。
    examples: [1200, 5800, 350]

  - name: status
    type: varchar(16)
    description: "取引ステータス"
    nullable: false
    domain:
      values:
        - completed    # 完了
        - cancelled    # キャンセル
        - returned     # 返品

statistics:
  row_count: 15000000
  date_range:
    from: "2020-01-01"
    to: "2025-12-31"
  update_frequency: "日次バッチ"
  # 以下はテーブル固有の拡張統計項目（additional として格納）
  avg_basket_size: 3.2
  top_categories: ["食品", "日用品", "衣料"]
  cancelled_rate: 0.05

notes_table_level:
  - "キャンセル済み取引もレコードとして残っている。売上集計時はstatus != 'cancelled'でフィルタすること。"
  - "2022年3月以前のデータは会員ID洗い替え前のため、customer_idの一貫性に注意。"
```

### カラム定義の属性

| 属性 | 必須 | 説明 | 備考 |
|---|---|---|---|
| `name` | ○ | カラム名（DB上の物理名） | |
| `type` | ○ | データ型（varchar, int, date, etc.） | |
| `description` | ○ | カラムの意味・説明（日本語、業務用語を含めて記述） | |
| `nullable` | ○ | NULL許容か否か | |
| `key_type` | 任意 | 結合キー種別（単一）。用語集の業務用語と整合させる | `key_types` と排他。主要な結合キーにはできるだけ記載 |
| `key_types` | 任意 | 条件付き結合キー種別（配列）。別カラムの値によってキー種別が異なる場合に使用 | `key_type` と排他。各要素に `value`（キー種別）は必須、`condition`（条件）はオプション |
| `domain` | 任意 | 取りうる値の定義（マスタ参照型 or 直接列挙型） | |
| `notes` | 任意 | このカラム固有の注意点・落とし穴 | |
| `examples` | 任意 | 値の具体例（2〜3個） | |

### statisticsの属性

| 属性 | 必須 | 説明 |
|---|---|---|
| `row_count` | 任意 | テーブルの行数 |
| `date_range` | 任意 | データの期間範囲（`from`, `to`） |
| `update_frequency` | 任意 | 更新頻度 |
| その他の任意キー | 任意 | テーブル固有の拡張統計項目。`row_count`, `date_range`, `update_frequency` 以外のキーは全て `additional` オブジェクトに格納される。キー名・値の型は自由（数値、文字列、配列等） |

**拡張統計項目の例:**
```yaml
# purchase_history の場合
statistics:
  row_count: 15000000
  update_frequency: "日次バッチ"
  avg_basket_size: 3.2
  top_categories: ["食品", "日用品", "衣料"]

# customer_master の場合
statistics:
  row_count: 500000
  update_frequency: "日次バッチ"
  active_ratio: 0.72
  avg_tenure_years: 4.5
```

YAML 上では `statistics` セクション内にフラットに記述する。既知の3フィールド（`row_count`, `date_range`, `update_frequency`）以外のキーは、API レスポンスで `additional` オブジェクトとしてまとめて返却される。

### key_typeの2パターン

```yaml
# パターン1：単一キー種別（通常ケース）
key_type: "統合会員番号"

# パターン2：条件付きキー種別（別カラムの値によって異なる場合）
key_types:
  - value: "統合会員番号"
    condition: "member_type = '正会員'"
  - value: "仮会員番号"
    condition: "member_type = '仮会員'"

# パターン2b：条件なし（condition 省略可能）
key_types:
  - value: "統合会員番号"
  - value: "仮会員番号"
```

**注意:** `key_type` と `key_types` は排他的で、1つのカラムに両方を指定することはできない。`condition` は省略可能で、省略した場合はキー種別のみの定義となる。

### domainの2パターン

```yaml
# パターン1：マスタ参照型（コード値の意味を別マスタで管理）
domain:
  master_table: facility_master
  master_column: facility_code
  label_column: facility_name

# パターン2：直接列挙型（少数で固定的な値）
domain:
  values:
    - completed    # 完了
    - cancelled    # キャンセル
    - returned     # 返品
```

### data_sourceの3パターン

```yaml
# パターン1：PostgreSQL（SQL検証用）
data_source:
  type: postgresql
  table: purchase_history

# パターン2：CSV（ファイルベース）
data_source:
  type: csv
  file_path: "data/purchase_history.csv"
  encoding: "utf-8"

# パターン3：外部データ（DB非依存、チャットから都度提供）
data_source:
  type: external
  format: "csv"
  description: "テナントマスタ。チャットからCSV/Excelファイルとして都度提供される。"
```

AIエージェントは `type` を見て、`postgresql` なら `pd.read_sql()`、`csv` なら `pd.read_csv()`、`external` ならチャットから提供されたデータをワークスペースに配置してから `pd.read_csv()` 等で読み込むコードを生成する。

### 用語インデックス（index.yaml）

```yaml
terms_index:
  - name: "ロイヤルティランク"
    summary: "統合会員の購買実績に基づく顧客ロイヤルティランク"
  - name: "統合会員ID"
    summary: "サンプル株式会社の統合顧客ID体系"
  - name: "店舗"
    summary: "各店舗の総称（東京店、大阪店等）"
```

### 用語詳細定義（例: ロイヤルティランク.yaml）

```yaml
name: "ロイヤルティランク"
aliases: ["ロイヤルティランク", "Loyalty Rank", "顧客ランク"]
definition: "統合会員の購買実績に基づく顧客ロイヤルティランク"
related_terms: ["統合会員ID"]
values:
  - label: "レギュラー"
    description: "基本ランク"
  - label: "シルバー"
    description: "年間購買額XX万円以上"
  - label: "ゴールド"
    description: "年間購買額XX万円以上"
  - label: "プラチナ"
    description: "年間購買額XX万円以上"
```

### 用語詳細の属性

| フィールド | 必須 | 説明 |
|---|---|---|
| `name` | ○ | 用語の正式名称 |
| `aliases` | ○ | 主要な別名・略称・通称・英語表記のリスト |
| `definition` | ○ | 用語の定義・説明 |
| `related_terms` | 任意 | 関連する他の用語名のリスト |
| `values` | 任意 | 値の体系がある場合のみ記載（コード値、ランク区分等） |

### ロジックインデックス（index.yaml）

```yaml
logic_index:
  - logic_name: "member_id_remapping"
    summary: "統合会員IDの洗い替え処理。洗い替え前IDを最新IDに変換する。"
    category: "前処理"
  - logic_name: "sales_basic_aggregation"
    summary: "店舗別・店舗別・顧客セグメント別の売上基礎集計（買上額・買上人数）"
    category: "集計"
```

### ロジックメタ定義（例: member_id_remapping.yaml）

```yaml
logic_name: "member_id_remapping"
description: |
  統合会員IDの洗い替え処理。会員統合やID体系変更に伴い、
  旧IDを最新のIDに変換する前処理。購買データ分析の前段で
  ほぼ必須となる処理。
file_path: "logic/code/sql/member_id_remapping.sql"
language: "sql"
usage_type: "template"
input_tables: ["purchase_history", "member_id_mapping"]
output_description: "洗い替え後のcustomer_idを持つトランザクションデータ"
usage_context: |
  購買データを使った分析の前処理として、ほぼ全ての分析で最初に適用する。
  2022年3月以前のデータは特に洗い替えが必要。
related_logic: ["sales_basic_aggregation"]
notes: |
  洗い替えマッピングテーブルは月次で更新される。
  最新のmapping_dateのレコードを使うこと。
```

### ロジックメタの属性

| フィールド | 必須 | 説明 |
|---|---|---|
| `logic_name` | ○ | 識別名（第1層と一致） |
| `description` | ○ | ロジックの詳細説明。目的・背景を業務用語で記述 |
| `file_path` | ○ | コードファイルへのパス |
| `language` | ○ | `sql` / `python` |
| `usage_type` | ○ | `template`：パラメータを変えてそのまま使う / `reference`：考え方を参考にして新たに書く |
| `input_tables` | ○ | 入力テーブル名のリスト |
| `output_description` | ○ | 出力の説明 |
| `usage_context` | 任意 | いつ・どういう場面で使うべきかの説明 |
| `related_logic` | 任意 | 関連ロジック名のリスト |
| `notes` | 任意 | 注意点・落とし穴 |

## API仕様

### データカタログ

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/catalog/index` | 全テーブルインデックスを返却 |
| POST | `/catalog/tables` | 指定テーブルの詳細を返却（一括取得対応、上限は `src/models.py` 参照） |

> リクエスト/レスポンスの詳細は [API仕様](../design/api-contracts.md) を参照。

### 用語集

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/glossary/index` | 用語インデックスを返却（query パラメータで検索可能、上限は `src/routers/terms.py` 参照） |
| POST | `/glossary/terms` | 指定用語の詳細を返却（一括取得対応、上限は `src/models.py` 参照） |

> リクエスト/レスポンスの詳細は [API仕様](../design/api-contracts.md) を参照。

### 既存ロジック

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/logic/index` | 全ロジックインデックスを返却 |
| POST | `/logic/meta` | 指定ロジックのメタ情報を返却（一括取得対応、上限は `src/models.py` 参照） |
| GET | `/logic/code/{logic_name}` | 指定ロジックのコードファイル内容を返却 |

> リクエスト/レスポンスの詳細は [API仕様](../design/api-contracts.md) を参照。

### 管理

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/admin/reload` | カタログ・用語集・ロジックの再読み込み |
| GET | `/health` | ヘルスチェック |

## 非機能要件

### NF1: パフォーマンス

| 項目 | 要件 |
|------|------|
| API応答時間 | 200ms以内 |
| 起動時間 | 5秒以内（100テーブル規模） |

### NF2: セキュリティ

- DB接続情報はJupyter環境の環境変数で管理（document-serverは関与しない）
- **認証:** Bearer トークン認証を実装済み。`DOCUMENT_SERVER_TOKEN` 環境変数でトークンを設定する。`/health` エンドポイントのみ認証除外

### NF3: 運用性

- カタログ・用語集・ロジックファイルの変更はAPI経由で再読み込み
- YAMLの構文エラーは起動時に検出・報告

## 技術仕様

### 技術スタック

- Python 3.11+ / FastAPI
- PyYAML（カタログ・用語集・ロジック読み込み）
- インメモリ（起動時にファイルを読み込み）

### 環境変数

> **正（SSoT）**: 環境変数の定義は各コンポーネントの `CLAUDE.md` を参照。ここでは要件としての説明のみ記載。

デフォルト値は `document-server/CLAUDE.md` を参照。

| 変数名 | 説明 |
|--------|------|
| `DATA_DIR` | データディレクトリの絶対パス。指定時はそのまま使用し `DATA_ENV` は無視される。未指定時は `./data/{DATA_ENV}` に解決 |
| `DATA_ENV` | データセット環境（`sample` / `production`）。`DATA_DIR` 未指定時のみ有効 |
| `PORT` | サーバーポート |
| `CORS_ORIGINS` | CORS許可オリジンのカンマ区切りリスト |
| `DOCUMENT_SERVER_TOKEN` | API認証トークン。未設定時は起動中止 |

### 起動コマンド

> **正（SSoT）**: 開発コマンドは `document-server/CLAUDE.md` を参照。

## 受け入れ条件

### AC1: データ読み込み
- [ ] 起動時に `DATA_ENV` で指定された環境のディレクトリからデータを読み込む（デフォルト: `sample`）
- [ ] `data/{DATA_ENV}/catalog/tables/` からテーブル定義を読み込む
- [ ] `data/{DATA_ENV}/catalog/external/` から外部データ定義を読み込む（ディレクトリが存在しない場合はスキップ）
- [ ] `data/{DATA_ENV}/glossary/` から用語集を読み込む
- [ ] `data/{DATA_ENV}/logic/` からロジック定義を読み込む
- [ ] 指定された環境ディレクトリが存在しない場合はエラーで起動失敗
- [ ] 複数ファイルを読み込める
- [ ] YAML構文エラーがあれば起動時にエラー表示
- [ ] statistics に既知3フィールド以外のカスタム統計項目を含むYAMLを正しく読み込める

### AC2: テーブル情報
- [ ] テーブルインデックスを取得できる（table_name, display_name, summary, category）
- [ ] テーブルインデックスに外部データ定義（`catalog/external/` 配下を直接パース）も含まれる
- [ ] 指定テーブルの詳細を取得できる（一括対応）
- [ ] 詳細に基本情報、データソース、カラム定義（key_type/key_types, domain含む）、基本統計量（additional含む）、注意点が含まれる
- [ ] statistics に additional（テーブル固有の拡張統計項目）が定義されている場合、テーブル詳細レスポンスに含まれる
- [ ] statistics に additional が未定義の場合でも、固定フィールド（row_count, date_range, update_frequency）のみで正常に返却される
- [ ] 条件付きkey_types（配列形式）を持つカラムが正しく返却される
- [ ] 存在しないテーブルを含む場合、見つかったものと見つからなかったもの両方を返却
- [ ] 一括取得の上限（`src/models.py` の `BULK_REQUEST_MAX` 参照）を超えた場合にバリデーションエラーが返る
- [ ] `data_source.type` が `external` のテーブル詳細が正しく返却される（format, description フィールド含む）

### AC3: 用語情報
- [ ] 用語インデックスを取得できる（name, summary）
- [ ] query パラメータなしで全件返却される
- [ ] query パラメータ指定時、name に部分一致する用語が返却される
- [ ] query パラメータ指定時、aliases に部分一致する用語が返却される
- [ ] query パラメータ指定時、related_terms に部分一致する用語が返却される
- [ ] query パラメータが上限（`src/routers/terms.py` の `max_length` 参照）を超えた場合にバリデーションエラーが返る
- [ ] query パラメータ指定時、ヒットなしの場合は空配列が返却される
- [ ] 指定用語の詳細を取得できる（一括対応）
- [ ] 詳細にaliases, definition, related_terms, valuesが含まれる
- [ ] 一括取得の上限（`src/models.py` の `BULK_REQUEST_MAX` 参照）を超えた場合にバリデーションエラーが返る

### AC4: ロジック情報
- [ ] ロジックインデックスを取得できる（logic_name, summary, category）
- [ ] 指定ロジックのメタ情報を取得できる（一括対応）
- [ ] 指定ロジックのコードファイルの中身を取得できる
- [ ] メタ情報にdescription, file_path, language, usage_type, input_tablesが含まれる
- [ ] 一括取得の上限（`src/models.py` の `BULK_REQUEST_MAX` 参照）を超えた場合にバリデーションエラーが返る
- [ ] logic_name に不正な文字（`src/routers/logic.py` のパスパラメータ定義を参照）が含まれる場合にバリデーションエラーが返る

### AC5: 再読み込み
- [ ] `/admin/reload` でカタログ・用語集・ロジックを再読み込みできる

## 依存関係

- なし（document-mcp が本サーバーに依存）
