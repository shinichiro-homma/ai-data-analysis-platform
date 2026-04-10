---
paths:
  - "**/*"
---

# テスト失敗時のワークフロー

テスト実行時に失敗が発生した場合、以下の手順で対応する。

## 1. 分類

- **自タスク起因**（現在のタスクで変更したコードが原因）→ 通常通り修正する
- **無関係**（現在のタスクと関係ない失敗）→ ステップ 2 へ進む

## 2. 既知障害の確認

```bash
scripts/manage-known-failures.sh check {コンポーネント名}
```

- **exit 0（登録済み）**: 既知障害のため対応不要。作業を継続する
- **exit 1（未登録）**: ステップ 3 へ進む

## 3. 未登録の失敗への対応

`AskUserQuestion` で以下の 3 択をユーザーに確認する：

1. **記録して継続** — `scripts/manage-known-failures.sh add` で既知障害登録してタスク続行
2. **Issue 起票して継続** — `scripts/create-test-issue.sh --add-known` で Issue 作成＆登録してタスク続行
3. **修正する** — `/custom-report-bug` の重要バグフローに従う

## 4. 再確認

対応後、`scripts/test.sh --health {コンポーネント名}` で新規障害がないことを確認する。既知障害のみなら exit 0 で正常終了する。
