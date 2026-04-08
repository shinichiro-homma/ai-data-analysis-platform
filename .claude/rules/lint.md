# Lint ルール

## lint の実行タイミング

`scripts/test.sh` はデフォルトで lint を含む（`--no-lint` でスキップ可能）。
カスタムコマンド（`start-task`, `complete-task`, `refactor` 等）は `test.sh` 経由で自動的に lint が走る。

単独実行: `scripts/lint.sh [COMPONENT]`

## lint 失敗時の対応

lint が失敗した場合、Claude は以下の手順で対応すること:

1. `lint.sh` のエラー出力から問題箇所と原因を読み取る
2. 該当ファイルを修正する（`--fix` による自動修正は使わない）
3. `scripts/lint.sh {対象コンポーネント}` を再実行して修正を確認する
4. lint が通ったら、中断していたテスト（`scripts/test.sh`）を再実行する

最大 3 回修正を試みても解決しない場合は、エラー内容をユーザーに報告して判断を仰ぐ。

## 禁止事項

- lint 失敗を無視してテストやコミットに進むこと
- `prettier --write` や `ruff format`（修正モード）を実行すること — 修正は Claude が手動で行う
- `--no-lint` を明示的な理由なく使うこと
