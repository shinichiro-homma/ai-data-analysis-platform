# 環境鮮度保証ルール

Docker 環境でのテスト実行時に、ソースコードとビルド成果物の鮮度を自動チェックする。

## 原則

- `scripts/test.sh --rebuild` を使えば、STALE なコンポーネントを自動検出・リビルドしてからテストを実行する
- `scripts/check-freshness.sh` で手動チェックも可能（`--strict` で exit 1、`--rebuild` で自動修正）
- 鮮度チェックの警告を無視してテストを続行してはならない
