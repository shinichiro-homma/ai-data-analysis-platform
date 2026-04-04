# Issue #56: load-data.py の文字列クリーニング正規表現がドメイン名等の正当なデータを NULL に変換する

## 関連タスク

- タスク番号: なし

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`load-data.py` のデータクリーニング処理で、全文字列カラムに `\.[a-zA-Z]{2,}$` の正規表現マッチを行い NULL に変換している。この正規表現が広すぎて、ドメイン名・URL・企業名・店舗名等の正当なデータを NULL にしてしまう。

### 影響カラム（主要なもの）

| テーブル | カラム | 影響件数 | 消失データ例 |
|----------|--------|----------|-------------|
| `dwh_of_users_detail` | `auth_domain` | 89,099 | `google.com`, `kddi.com` |
| `dm_オフィス_勤務者` | `ドメイン` | 90,971 | `ehills.co.jp`, `disney.com` |
| `dwh_of_users_detail` | `company_nm` | 43 | `Apple Japan.Inc` |
| `dwh_ow_corp_fo` | `corporate_image_url` | 107 | 画像URL |
| `dwh_sdt_biz_shop_inf` | `store_designation` | 70 | `A.D.NEEL`, `WANS.Tokyo` |
| `dwh_sdt_biz_shop_inf` | `official_store_nm` | 166 | 同上 |
| `dwh_ap_event_application_forms` | `title` / `title_en` | 1 | `To/&co.Exhibition` |

## 再現手順

1. `scripts/clean-rebuild.sh --env production -y` で環境構築
2. `SELECT auth_domain FROM dwh_of_users_detail WHERE auth_domain IS NOT NULL LIMIT 5;` → 0 rows

## 期待する動作

Parquet 内の `auth_domain` データ（`google.com` 等）がそのまま DB に格納される。

## 原因

`scripts/lib/generate_init.py` が生成する `load-data.py` 内の文字列クリーニング処理:

```python
has_alpha_frac = pc.match_substring_regex(col, r"\.[a-zA-Z]{2,}$")
mask = pc.or_(is_empty, has_alpha_frac)
arrays[i] = pc.if_else(mask, None, col)
```

元の意図は `dwh_ju_mb_m_tenant` の日付文字列に残る `.fffffff`（未解決フォーマットプレースホルダー）を除去すること。しかし正規表現が全文字列カラムに適用されるため、`.com`, `.co.jp`, `.Inc` 等にもマッチする。

実際に `.fffffff` 問題があるのは `dwh_ju_mb_m_tenant` の3カラム（`disp_update_date`, `register_date`, `update_date`）のみ。

## 修正方針

### 方針

1. 全文字列カラムへの正規表現マッチ（`has_alpha_frac`）を廃止
2. `generate_init.py` でカタログ YAML の型情報を参照し、Parquet 上は文字列だがカタログ上は日付/タイムスタンプ型のカラムを `timestamp_str_columns` として TABLES に含める
3. `load_table` で `timestamp_str_columns` に対して、有効な日時部分を正規表現で抽出し不正部分を除去する（`.fffffff` 以外の例外パターンにも対応する汎用アプローチ）
   - 抽出パターン: `^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[+-]\d{2}:?\d{2}|Z)?)`
   - マッチした部分のみを保持し、マッチしない値は NULL にする

### 影響範囲

- `scripts/lib/generate_init.py` — TABLES 生成ロジック + load_table テンプレート
- `postgres/init/production/load-data.py` — 再生成
- `postgres/init/sample/load-data.py` — 再生成

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `scripts/lib/generate_init.py` | TABLES に `timestamp_str_columns` を追加、load_table のクリーニングを汎用日時抽出ロジックに変更 |
| `postgres/init/production/load-data.py` | 再生成（`scripts/generate-init-scripts.sh production`） |
| `postgres/init/sample/load-data.py` | 再生成（`scripts/generate-init-scripts.sh sample`） |

### テスト計画

1. `scripts/generate-init-scripts.sh production && scripts/generate-init-scripts.sh sample` で再生成
2. `scripts/clean-rebuild.sh --env production --skip-mcp -y` で DB 再構築
3. `SELECT auth_domain FROM dwh_of_users_detail WHERE auth_domain IS NOT NULL LIMIT 5;` で非NULL確認
4. `SELECT disp_update_date FROM dwh_ju_mb_m_tenant WHERE disp_update_date LIKE '%.fffffff' LIMIT 5;` で `.fffffff` が除去されていること確認
