# Issue #30: generate_init.py が複合主キーテーブルで不正な SQL を生成し、production 環境のテーブル作成が失敗する

## 関連タスク

- タスク番号: Infrastructure 5.2

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`scripts/generate-init-scripts.sh production` で生成される `create-tables.sql` が、複合主キー（複数カラムに `key_type` が設定されている）テーブルで、各カラムに個別のインライン `PRIMARY KEY` を出力する。PostgreSQL では `PRIMARY KEY` はテーブルに1つしか指定できないため、2番目のテーブル `dwh_sdt_character_inf` の CREATE TABLE で構文エラーが発生する。

`01-init-db.sh` が `ON_ERROR_STOP=1` で実行されるため、1番目のテーブル `dwh_sdt_customer_inf` のみが作成され、残り27テーブルが作成されない。

## 再現手順

1. `scripts/switch-env.sh production` で本番環境に切り替え
2. Claude Desktop から jupyter-mcp 経由で `dm_purchase_history` テーブルにアクセス
3. 「テーブルが見当たりません」エラーが発生

### 再現確認結果

- 再現: できた
- 確認方法: `postgres/init/production/create-tables.sql` を直接確認
- エビデンス: `dwh_sdt_character_inf` の定義（46-59行目）に5つのインライン `PRIMARY KEY` が存在

## 期待する動作

複合主キーのテーブルでは、テーブル末尾に `PRIMARY KEY (col1, col2, ...)` を出力し、全28テーブルが正常に作成されること。

## 原因

`scripts/lib/generate_init.py` の `generate_create_tables` → `format_column_def` → `is_primary_key` の処理フローが複合主キーを考慮していない。

- `is_primary_key(col)` (175-185行目): `key_type` フィールドが存在し、かつ `domain.master_table` を持たないカラムをすべて `True` と判定する。テーブル全体で何個が主キーかを考慮しない。
- `format_column_def(col)` (146-172行目): `is_primary_key()` が `True` のカラムにインラインで `PRIMARY KEY` を付与する。
- `generate_create_tables()` (120-143行目): テーブルレベルの複合主キー制約を生成するロジックが存在しない。

結果: production 環境の `dwh_sdt_character_inf` (5カラム) など16テーブルで複数のインライン `PRIMARY KEY` が出力され、PostgreSQL が構文エラーを返す。`ON_ERROR_STOP=1` により後続の全テーブル作成も中断される。

sample 環境は複合主キーのテーブルが存在しないため影響なし。

## 修正方針

`format_column_def` からインライン `PRIMARY KEY` を廃止し、全テーブルで一律テーブルレベル制約 `PRIMARY KEY (...)` に統一する。単一/複合で処理を分ける必要がなくなり、コードがシンプルになる。

### 修正内容

1. `format_column_def`: `PRIMARY KEY` のインライン出力を削除。`is_primary_key()` の呼び出しは `NOT NULL` 判定に引き続き使用（PK カラムは暗黙的に NOT NULL のため）
2. `generate_create_tables`: テーブルごとに主キーカラムを収集し、カラム定義の末尾にテーブルレベル制約 `PRIMARY KEY ("col1", "col2", ...)` を追加

### 影響範囲

- `scripts/lib/generate_init.py` のみを修正
- 修正後に `scripts/generate-init-scripts.sh production` を再実行して `postgres/init/production/create-tables.sql` を再生成
- sample 環境も再生成（単一主キーがインラインからテーブルレベルに変わるため差分あり）
- 要件定義・API仕様の変更は不要

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `scripts/lib/generate_init.py` | `format_column_def` からインライン PK 出力を削除、`generate_create_tables` にテーブルレベル PK 制約を追加 |
| `postgres/init/production/create-tables.sql` | 再生成（自動） |
| `postgres/init/sample/create-tables.sql` | 再生成（自動、インライン→テーブルレベルに変更） |

### テスト計画

1. `scripts/generate-init-scripts.sh production` を実行し、生成された `create-tables.sql` を確認:
   - 全テーブルでインライン `PRIMARY KEY` がないこと
   - 全テーブルの末尾に `PRIMARY KEY ("col1", ...)` があること
2. `scripts/generate-init-scripts.sh sample` を実行し、sample 環境の SQL も同様に正しいことを確認
3. 生成された production SQL を `psql` で実行し、全28テーブルが作成されることを確認（`scripts/switch-env.sh production` で検証）

