---
paths:
  - "scripts/lint.sh"
  - "scripts/test.sh"
---

# Lint ルール

## lint の実行タイミング

`scripts/test.sh` がデフォルトで lint を含む（`--no-lint` でスキップ可、明示的理由なしの使用禁止）。カスタムコマンド（`start-task`, `complete-task`, `refactor` 等）では自動実行される。単独実行は `scripts/lint.sh [COMPONENT]`。

## lint 失敗時の対応

1. `lint.sh` のエラー出力から問題箇所と原因を読み取る
2. 該当ファイルを手動で修正する（`--fix` や `prettier --write` / `ruff format` 等の自動修正モードは使わない）
3. `scripts/lint.sh {対象コンポーネント}` を再実行して確認
4. lint が通ったら中断していた `scripts/test.sh` を再実行

最大 3 回修正を試みても解決しない場合は、エラー内容をユーザーに報告して判断を仰ぐ。lint 失敗を無視してテストやコミットに進んではならない。
