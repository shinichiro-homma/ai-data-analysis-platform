# Issue #55: export_sql で大量データ Parquet エクスポート時にスキーマ不一致エラー

## 関連タスク

- タスク番号: なし

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`export_sql` で約1,000万件のデータを Parquet エクスポートすると `FILE_WRITE_ERROR` が発生する。

```json
{
  "success": false,
  "error": {
    "code": "FILE_WRITE_ERROR",
    "message": "An unexpected error occurred during SQL execution"
  }
}
```

Docker ログには以下のエラーが記録される:

```
ValueError: Table schema does not match schema used to create file:
table: purchase_amount_ex_tax: decimal128(28, 20)
file:  purchase_amount_ex_tax: decimal128(27, 20)
```

## 再現手順

1. PostgreSQL に大量データ（1,000万件以上）が入っている production 環境で実行
2. `CAST(col AS NUMERIC) / 1.10` のような NUMERIC 演算を含むクエリを `export_sql` で Parquet エクスポート
3. チャンク間で decimal 精度が変わるデータ分布の場合にエラー発生

## 期待する動作

データ件数やNUMERIC精度に関わらず、Parquet ファイルが正常に生成される。

## 原因

`_write_parquet_chunked()` が各チャンク（10,000行）で `pa.Table.from_pandas(df)` を実行し、pandas の型推論に依存。PostgreSQL の `NUMERIC` 型は精度が可変で、チャンクに含まれるデータの値域によって PyArrow が推論する `decimal128` の精度（precision）が変わる。初回チャンクのスキーマで `ParquetWriter` を初期化した後、後続チャンクで精度が異なると `ValueError` が発生する。

## 修正方針

初回チャンクのスキーマ取得後、`decimal128` 系フィールドを `float64` に正規化し、全チャンクをこの正規化スキーマにキャストしてから書き出す。

**float64 を選択する理由:**
- 分析プラットフォーム用途では float64 の精度（有効桁15-16桁）で十分
- `CAST(total_fee AS NUMERIC) / 1.10` のような計算結果は既に近似値
- pandas/polars で直接扱える最も互換性の高い数値型

### 影響範囲

- `export_sql` の Parquet エクスポートのみ
- CSV エクスポート、`execute_sql` には影響なし

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-server/extensions/custom_api/sql_handlers.py` | `_normalize_parquet_schema()` 追加 + `_write_parquet_chunked()` 修正 |
| `jupyter-server/tests/test_sql_handlers.py` | スキーマ正規化のユニットテスト追加 |

### テスト計画

1. `scripts/test.sh --rebuild jupyter-server` でユニットテスト
2. 実際に `export_sql` で同じクエリを実行し、エラーなく Parquet が生成されることを確認
