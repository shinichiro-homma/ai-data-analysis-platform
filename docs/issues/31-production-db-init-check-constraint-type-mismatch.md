# Issue #31: production環境のDB初期化がCHECK制約の型不整合で失敗する

## 関連タスク

- タスク番号: Infrastructure 5.1〜5.4（Infrastructure Phase 5: テーブル追加フロー自動化）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`scripts/generate-init-scripts.sh production` で生成された `create-tables.sql` が、`dwh_of_users_detail` テーブルのCHECK制約でSQLエラーとなり、以下の影響が発生する：

1. **8テーブルが作成されない**: `dwh_of_users_detail` 以降の8テーブルが未作成
   - `dwh_ow_worker_fo`, `dwh_ow_corp_fo`, `dwh_ap_event_application_forms`, `dwh_ap_event_applications`, `dwh_ap_event_application_time_spans`, `dwh_ap_event_order_tickets`, `dwh_ma_scenario_history`, `dwh_benefit_grant_history`
2. **データロードが全く実行されない**: `ON_ERROR_STOP=1` + `set -euo pipefail` により全28テーブルのデータが空
3. **sample環境の WARNING**: `purchase_history` の YAML に `member_code` カラムが定義されているが CSV に存在しない

### エラーメッセージ

```
ERROR: invalid input syntax for type double precision: "0.0：未保有"
```

```sql
"hills_card_flag" DOUBLE PRECISION CHECK ("hills_card_flag" IN ('0.0：未保有', '1.0：保有'))
```

## 再現手順

1. `scripts/generate-init-scripts.sh production` を実行
2. `scripts/switch-env.sh production -y` を実行
3. `docker exec analysis-db psql -U jupyter -d analysis_db -c "\dt"` でテーブル一覧を確認 → 20テーブルのみ
4. `docker logs analysis-db 2>&1 | grep ERROR` でエラーを確認

## 再現確認結果

- 再現: できた
- 確認方法: Docker環境で `switch-env.sh production -y` を実行
- エビデンス:
  - `docker logs analysis-db` で `ERROR: invalid input syntax for type double precision: "0.0：未保有"` を確認
  - 20/28テーブルのみ作成、データロードは0テーブル
  - CSVの実データは `hills_card_flag` = `1.0`（数値）

## 期待する動作

- sample環境・production環境の両方で、全テーブルがエラーなく作成され、全CSVデータがロードされること
- `scripts/switch-env.sh sample -y` と `scripts/switch-env.sh production -y` の双方向切り替えがエラーなく完了すること
- `generate-init-scripts.sh` が WARNING なしで完了すること

## 原因

### 根本原因1: CHECK制約の型チェック欠如

`scripts/lib/generate_init.py` 170行目の `format_column_def` 関数が、`domain.values` を**常に文字列リテラル**（`'...'`）として CHECK 制約に展開している。数値型カラム（`double precision` 等）に対しても文字列リテラルが生成されるため、PostgreSQL が型不整合エラーを返す。

```python
# 170行目 — 型チェックなし、常に文字列リテラル
values_str = ", ".join(f"'{v}'" for v in domain["values"])
```

### 根本原因2:「値：ラベル」形式の未解析

`dwh_of_users_detail.yaml` の `hills_card_flag` の `domain.values` に `0.0：未保有`, `1.0：保有` という「値：ラベル」形式の文字列が定義されている。`generate_init.py` はこの形式を解析せず、全角コロン `：` を含む文字列全体を CHECK 値として使用している。

生成される SQL:
```sql
CHECK ("hills_card_flag" IN ('0.0：未保有', '1.0：保有'))
```

正しくは:
```sql
CHECK ("hills_card_flag" IN (0.0, 1.0))
```

### 根本原因3: sample環境の YAML-CSV 不整合

`document-server/data/sample/catalog/tables/purchase_history.yaml` の 122行目に `member_code` カラムが定義されているが、対応する CSV (`postgres/data/sample/purchase_history.csv`) にはこのカラムが存在しない。

### 潜在的問題1: 他の「値：ラベル」形式

production環境の多数のYAMLファイルで `varchar` 型カラムに「値：ラベル」形式の `domain.values` が使われている（例: `0：仮登録`, `1：対象`）。現状は文字列型なので SQL エラーにはならないが、実データが `0` なのに CHECK が `'0：仮登録'` だとデータロード時に不整合が発生する可能性がある。

### 根本原因4: `key_type` による誤ったPK生成

`scripts/lib/generate_init.py` 176-186行目の `is_primary_key()` 関数が、`key_type` フィールドを持つカラム（FK参照がないもの）をすべてPKとして扱っている。

```python
def is_primary_key(col):
    if col["type"].lower() == "serial":
        return True
    if "key_type" in col:
        domain = col.get("domain")
        if not isinstance(domain, dict) or "master_table" not in domain:
            return True
    return False
```

しかし `key_type` はドキュメント用途のフィールドで、「このカラムが何の識別子体系に属するか」を示す（例: `OTAC会員番号（断面）`, `ビルコード`, `WB会員番号`）。PKかどうかを示すものではない。

影響:
- `dwh_of_users_detail`: 4カラムに `key_type` → 4カラムの複合PKが誤生成
- `dwh_pa_all_user_records`: 8カラムに `key_type` → 8カラムの複合PKが誤生成
- 多数のproductionテーブルで不正な複合PKが生成され、データロード時に重複エラーが発生する可能性が高い

## 修正方針

### アプローチ

`generate_init.py` のSQL生成ロジックから、カタログYAMLのドキュメント用フィールドをDB制約に変換している部分を削除する:

1. **CHECK 制約の生成を削除** (169-171行目): `domain.values` はドキュメント用途（値域の説明）であり、DB の CHECK 制約として使うべきではない
2. **PK生成を完全に削除**: `is_primary_key()` 関数と関連ロジック（139-142行目、158行目）を削除。カタログYAMLにPK定義が存在しないため、推測でPKを付けるべきではない。DWHテーブルにPKは不要。将来必要になればカタログYAMLにテーブルレベルの `primary_key` フィールドを追加する（別タスク）

### sample環境の `member_code` 問題

`purchase_history.yaml` から `member_code` カラム定義を削除する（CSVに存在しないカラム）。

### 影響範囲

- `scripts/lib/generate_init.py` — CHECK 制約生成ロジックの削除 + PK生成ロジックの完全削除
- `document-server/data/sample/catalog/tables/purchase_history.yaml` — `member_code` 削除
- 生成される `postgres/init/*/create-tables.sql` — 再生成が必要
- 生成される `postgres/init/*/load-data.sh` — 再生成が必要

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `scripts/lib/generate_init.py` | (1) CHECK 制約生成の3行を削除 (2) `is_primary_key()` 関数とPK関連ロジックを完全削除 (3) REFERENCES（FK）制約生成を削除（PKがないためFKも不成立） |
| `document-server/data/sample/catalog/tables/purchase_history.yaml` | `member_code` カラム定義を削除 |

修正後、以下を再生成:

| ファイル | 変更内容 |
|----------|----------|
| `postgres/init/sample/create-tables.sql` | `scripts/generate-init-scripts.sh sample` で再生成 |
| `postgres/init/sample/load-data.sh` | 同上 |
| `postgres/init/production/create-tables.sql` | `scripts/generate-init-scripts.sh production` で再生成 |
| `postgres/init/production/load-data.sh` | 同上 |

### テスト計画

1. **生成確認**: `scripts/generate-init-scripts.sh production` と `sample` を実行し、WARNING なしで完了することを確認
2. **生成SQL確認**: `postgres/init/production/create-tables.sql` に CHECK 制約が含まれないことを確認
3. **生成SQL確認**: PKが生成されていないことを確認
4. **sample環境テスト**: `scripts/switch-env.sh sample -y` で全テーブル作成・データロードが成功することを確認
5. **production環境テスト**: `scripts/switch-env.sh production -y` で全テーブル作成・データロードが成功することを確認
6. **双方向切り替え**: sample → production → sample の切り替えがエラーなく完了することを確認
