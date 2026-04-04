# ロジック追加手順

既存の分析ロジック（SQL/Python）をロジックライブラリに追加し、AIが参照・再利用できるようにする手順。

## 概要

ロジックライブラリに登録すると、AIが `get_logic_index` / `get_logic_detail` / `get_logic_code` ツールでロジックのメタ情報とコードを参照できるようになる。類似の分析を行う際にゼロから書くのではなく、既存ロジックをベースに分析を組み立てられる。

### usage_type（利用形態）

| 値 | 意味 | 用途 |
|----|------|------|
| `template` | テンプレートとして流用 | パラメータを変えてそのまま使えるSQL/コード |
| `reference` | 参考実装として参照 | ロジックの考え方を参考にして新たにコードを書く |

## 前提条件

- Docker環境が起動済み（`docker-compose up -d`）
- 追加するSQL/Pythonコードが手元にある

---

## 手順

### 1. コードファイルを配置

言語に応じたディレクトリにコードファイルを配置する。

```
document-server/data/logic/code/
├── sql/
│   └── {ロジック名}.sql       ← SQLの場合
└── python/
    └── {ロジック名}.py        ← Pythonの場合
```

**ロジック名の命名規則:** 英数字・アンダースコア・ハイフンのみ（`^[a-zA-Z0-9_-]+$`）。最大100文字。

**SQLの例:**

```sql
-- member_id_remapping.sql
SELECT
  COALESCE(m.new_member_id, t.customer_id) AS customer_id,
  t.transaction_id,
  t.transaction_date,
  t.amount,
  t.store_id
FROM purchase_history t
LEFT JOIN member_id_mapping m
  ON t.customer_id = m.old_member_id
WHERE m.mapping_date = (SELECT MAX(mapping_date) FROM member_id_mapping)
   OR m.mapping_date IS NULL;
```

**Pythonの例:**

```python
# sales_basic_aggregation.py
import pandas as pd

def aggregate_sales(
    df_transactions: pd.DataFrame,
    df_customers: pd.DataFrame,
) -> pd.DataFrame:
    """店舗別・顧客セグメント別の売上基礎集計"""
    merged = df_transactions.merge(df_customers, on="customer_id")
    result = merged.groupby(["store_id", "segment"]).agg(
        total_amount=("amount", "sum"),
        customer_count=("customer_id", "nunique"),
    ).reset_index()
    return result
```

### 2. インデックスにエントリを追加

`document-server/data/logic/index.yaml` にエントリを追加する。

```yaml
logic_index:
  # ... 既存エントリ ...
  - logic_name: "{ロジック名}"
    summary: "{ロジックの概要（1行）}"
    category: "{カテゴリ}"
```

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `logic_name` | Yes | ロジック識別名。コードファイル名（拡張子除く）と一致させること |
| `summary` | Yes | 一行の概要説明 |
| `category` | Yes | カテゴリ（「前処理」「集計」等） |

### 3. メタ情報YAMLを作成

`document-server/data/logic/meta/{ロジック名}.yaml` を新規作成する。

```yaml
logic_name: "{ロジック名}"
description: |
  {ロジックの詳細な説明。}
  {複数行で記載可能。}
file_path: "logic/code/{sql|python}/{ロジック名}.{sql|py}"
language: "{sql|python}"
usage_type: "{template|reference}"
input_tables: ["{入力テーブル1}", "{入力テーブル2}"]
output_description: "{出力の説明}"
# usage_context: |
#   {いつ・どのような場面で使うべきかの説明}
# related_logic: ["{関連ロジック名}"]
# notes: |
#   {注意点・落とし穴}
```

**フィールド一覧:**

| フィールド | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `logic_name` | Yes | string | ロジック識別名。`index.yaml` と一致させること |
| `description` | Yes | string | ロジックの詳細説明 |
| `file_path` | Yes | string | コードファイルへの相対パス（`data/` からの相対） |
| `language` | Yes | string | `"sql"` または `"python"` |
| `usage_type` | Yes | string | `"template"` または `"reference"` |
| `input_tables` | Yes | string[] | 入力テーブル名のリスト |
| `output_description` | Yes | string | 出力結果の説明 |
| `usage_context` | No | string | いつ使うべきかの説明 |
| `related_logic` | No | string[] | 関連ロジック名のリスト |
| `notes` | No | string | 注意点・落とし穴 |

**具体例（SQL / template）:**

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

**具体例（Python / reference）:**

```yaml
logic_name: "sales_basic_aggregation"
description: |
  店舗別・顧客セグメント別の売上基礎集計処理。
  買上額・買上人数をピボット集計し、分析用の基礎データを作成する。
file_path: "logic/code/python/sales_basic_aggregation.py"
language: "python"
usage_type: "reference"
input_tables: ["purchase_history", "customer_master"]
output_description: "店舗別・顧客セグメント別の売上集計DataFrame"
```

### 4. ロジックライブラリを反映

document-serverに再読み込みを指示する。

```bash
curl -X POST http://localhost:3002/admin/reload
```

### 5. 動作確認

以下を確認する:

1. `GET /logic/index` でロジック一覧に表示されること
2. `POST /logic/meta` でメタ情報が取得できること
3. `GET /logic/code/{ロジック名}` でコードが取得できること

```bash
# インデックス確認
curl http://localhost:3002/logic/index | jq .

# メタ情報確認
curl -X POST http://localhost:3002/logic/meta \
  -H "Content-Type: application/json" \
  -d '{"logic_names": ["{ロジック名}"]}' | jq .

# コード確認
curl http://localhost:3002/logic/code/{ロジック名} | jq .
```

---

## 注意事項

- **名前の一致**: `index.yaml` の `logic_name`、メタYAMLの `logic_name`、メタYAMLファイル名、コードファイル名（拡張子除く）はすべて一致させること。不一致があると起動時に警告ログが出力される。
- **`file_path` のセキュリティ制約**: `file_path` は `data/` ディレクトリからの相対パスで指定する。`..` を含むパスや絶対パス（`/` 始まり）は拒否される（パストラバーサル防止）。
- **`input_tables` の参照先**: データカタログに登録済みのテーブル名を指定すること。AIがロジックの入力テーブル構造を参照する際にカタログ情報を利用する。
- **`related_logic` の参照先**: ロジックライブラリに登録済みのロジック名を指定すること。
- **`logic_name` の命名規則**: APIのパスパラメータとして使われるため、英数字・アンダースコア・ハイフンのみ使用可能（`^[a-zA-Z0-9_-]+$`、最大100文字）。日本語は使えない。
