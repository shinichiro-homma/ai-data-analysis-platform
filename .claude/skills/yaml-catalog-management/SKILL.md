# YAML カタログ管理

データカタログ（テーブル・用語・ロジック）の YAML 定義パターン。追加・編集・DB 反映までの一連のフローをカバーする。

## 共通アーキテクチャ

3カタログすべてが **2層構造**（インデックス + 詳細）を持つ。

```
document-server/data/{ENV}/
├── catalog/
│   ├── index.yaml              # テーブルインデックス
│   ├── tables/{name}.yaml      # テーブル詳細
│   └── external/{name}.yaml    # 外部テーブル（PostgreSQL 非管理）
├── glossary/
│   ├── index.yaml              # 用語インデックス
│   └── terms/{name}.yaml       # 用語詳細
└── logic/
    ├── index.yaml              # ロジックインデックス
    ├── meta/{name}.yaml        # ロジックメタ情報
    └── code/{sql|python}/      # 実コード
```

環境: `sample`（PoC用、git 管理）、`production`（本番用、.gitignore）

## テーブルカタログ

### index.yaml

```yaml
tables_index:
  - table_name: "purchase_history"    # 必須: テーブル識別名
    display_name: "購買履歴"           # 必須: UI 表示名
    summary: "顧客の購買履歴データ"    # 必須: 1行説明
    category: "トランザクション系"     # 必須: 分類
```

### tables/{table_name}.yaml

```yaml
table_name: purchase_history          # 必須: index と一致
display_name: 購買履歴                # 必須
summary: "顧客の購買履歴データ"       # 必須
category: トランザクション系          # 必須
description: |                        # 必須
  詳細説明...

data_source:                          # 必須
  type: postgresql                    # postgresql | csv | external
  table: purchase_history             # postgresql/csv 時は必須

columns:                              # 必須（空配列不可）
  - name: transaction_id              # 必須
    type: varchar(20)                 # 必須（SQL 型）
    description: "取引ID"             # 必須
    nullable: false                   # 必須

    # --- 以下オプション ---
    key_type: "統合会員番号"          # キー種別（単一）
    # OR
    key_types:                        # キー種別（条件付き、key_type と排他）
      - value: "OTAC会員番号"
        condition: "2022年3月以降"

    domain:                           # 値域（以下いずれかの形式）
      master_table: customer_master   # マスタ参照型
      master_column: customer_id
      label_column: customer_name
    # OR
    domain:                           # 直接列挙型
      values:
        - 店舗
        - EC

    notes: "注記"
    examples: ["TX20240101001"]

statistics:                           # オプション
  row_count: 15000000
  date_range:
    from: "2020-01-01"
    to: "2025-12-31"
  update_frequency: "日次バッチ"

notes_table_level:                    # オプション
  - "テーブルレベルの注記..."
```

### 外部テーブル（external/）

`data_source.type: external` のテーブルは `catalog/external/` に配置。PostgreSQL に格納されず、カタログ情報のみ提供。

## 用語集

### index.yaml

```yaml
terms_index:
  - name: "ロイヤルティランク"        # 必須: 用語正式名
    summary: "顧客の購買実績ランク"   # 必須: 1行説明
```

### terms/{name}.yaml

```yaml
name: "ロイヤルティランク"            # 必須: ファイル名と一致
aliases:                              # 必須（空配列可）
  - "ロイヤルティランク"
  - "Loyalty Rank"
  - "顧客ランク"
definition: "統合会員の購買実績に基づく..." # 必須

related_terms:                        # オプション
  - "統合会員ID"
values:                               # オプション（値の体系がある場合）
  - label: "レギュラー"
    description: "基本ランク"
  - label: "シルバー"
    description: "年間購買額XX万円以上"
```

**検索の仕組み:** `aliases` の全エントリが小文字正規化され、部分一致検索インデックスに登録される。

## ロジックライブラリ

### index.yaml

```yaml
logic_index:
  - logic_name: "member_id_remapping"  # 必須: 英数・アンダースコア・ハイフンのみ
    summary: "統合会員IDの洗い替え"     # 必須: 1行説明
    category: "前処理"                 # 必須: 分類
```

### meta/{logic_name}.yaml

```yaml
logic_name: "member_id_remapping"     # 必須: index と一致
description: |                        # 必須
  統合会員IDの洗い替え処理...

file_path: "logic/code/sql/member_id_remapping.sql"  # 必須: data/ からの相対パス
language: "sql"                       # 必須: sql | python
usage_type: "template"                # 必須: template | reference

input_tables:                         # 必須
  - "purchase_history"
  - "member_id_mapping"
output_description: "洗い替え済み購買履歴" # 必須

usage_context: |                      # オプション
  購買データを使った分析の前処理として...
related_logic:                        # オプション
  - "sales_basic_aggregation"
notes: |                              # オプション
  洗い替えマッピングテーブルは月次で更新...
```

**コード配置:** `logic/code/sql/` または `logic/code/python/` に配置。`file_path` はパストラバーサル防止（`..` 拒否）あり。

## 3カタログの比較

| 項目 | テーブル | 用語 | ロジック |
|------|---------|------|---------|
| 識別子 | `table_name` | `name` | `logic_name` |
| インデックスキー | `tables_index` | `terms_index` | `logic_index` |
| 詳細ディレクトリ | `tables/` | `terms/` | `meta/` |
| 参照関係 | domain.master_table | related_terms | input_tables, related_logic |
| 検索機能 | なし | aliases で部分一致 | なし |
| 外部ファイル | なし | なし | code/ にSQL/Python |

## DB 反映フロー

テーブルカタログを変更した場合の反映手順:

```
1. YAML 編集
   └─ catalog/index.yaml + tables/{name}.yaml

2. init スクリプト再生成
   └─ scripts/generate-init-scripts.sh {ENV}
      → postgres/init/{ENV}/create-tables.sql
      → postgres/init/{ENV}/load-data.py

3. Parquet 準備（新テーブルの場合）
   └─ scripts/convert-csv-to-parquet.py {ENV}
      → data/{ENV}/parquet/{table_name}.parquet

4. DB 再構築
   └─ scripts/rebuild.sh postgres
      → PostgreSQL コンテナ再作成 + データロード

5. カタログリロード
   └─ POST /admin/reload（document-server）
      → 自動: rebuild.sh が実行
```

**用語・ロジックの場合:** DB 再構築は不要。`POST /admin/reload` のみで反映される。

## バリデーション

Pydantic モデル（`document-server/src/models.py`）で検証:

- `key_type` と `key_types` は排他（同時指定不可）
- `file_path` にパストラバーサル（`..`）を含む場合はエラー
- `columns` は空配列不可
- インデックスに存在するが詳細ファイルがない場合は起動時に警告ログ

## よくあるエラー

| エラー | 原因 | 対処 |
|--------|------|------|
| インデックスと詳細の不一致 | `table_name` が index と detail で異なる | 識別子を揃える |
| Parquet スキーマ不一致 | YAML のカラムが Parquet に存在しない | generate-init-scripts が自動除外するが、YAML 側を修正すべき |
| 参照整合性エラー | `input_tables` に存在しないテーブル名 | カタログにテーブルを追加してから参照する |
| aliases 検索で見つからない | aliases にバリエーションが不足 | 略称、英語名、カタカナ等を追加 |
