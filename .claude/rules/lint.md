---
paths:
  - "scripts/lint.sh"
  - "scripts/test.sh"
---

# Lint ルール

## lint の実行タイミング

`scripts/test.sh` がデフォルトで lint を含む。カスタムコマンド（`start-task`, `complete-task`, `refactor` 等）では自動実行される。単独実行は `scripts/lint.sh [COMPONENT]`。

`--no-lint` の使用は以下に限る（それ以外は明示的理由なしの使用禁止）:

- 反復中のスコープ実行（`.claude/rules/tdd.md` の「テスト実行コマンドの規律」参照）。保存時の自動整形は format-on-save hook が担い、フェーズ締めのフルゲート（lint 込みの `scripts/test.sh --quiet {コンポーネント名}`）を必ず通すこと

## ruff ASYNC ルールの方針（Python 3 コンポーネント）

`docs/design/invariants.md` の I3（async コンテキストでブロッキング I/O をしない）を機械検知するため、ruff の `ASYNC` を `select` に入れている。選択状況・抑制対象の具体は各コンポーネントの `pyproject.toml` が正。

- **ASYNC240 は部分的な網であり、I3 の保証ではない。** ruff は `Path(p).resolve()` のように `Path(...)` から直接メソッドを呼ぶ形は検知するが、`d = Path(root) / name` のように join を挟むと型推論が切れて以降のメソッド呼び出しを検知しない。pandas の `df.to_csv()` のようなライブラリ経由の I/O も原理的に検知できない。**ゲートがグリーンでも async 関数内のブロッキング I/O は残りうる**ため、レビュー時は目視でも確認する。オフロードが必要な場合は `_{名前}_sync()` を定義して `loop.run_in_executor(None, ...)` から呼ぶ既存イディオムに揃える
- **ASYNC109（async 関数の `timeout` 引数）はコンポーネント全体の `ignore` にせず、`[tool.ruff.lint.per-file-ignores]` で既存の該当ファイルに限定する。** `timeout` は REST API が公開するパラメータの契約であり、ロック取得後の deadline 計算や二段構えのタイムアウトなど呼び出し側の `asyncio.timeout` では代替できない実装になっているため抑制自体は妥当だが、全体 `ignore` にすると将来の新規 async 関数まで恒久的に検知外になる。新規ファイルで ASYNC109 が出た場合は、抑制対象を増やす前に `asyncio.timeout` で代替できないかを検討する

## ファイルサイズ予算ゲート

既存の超過ファイル 17 件を分割せずにゲートを導入するため、ラチェット方式を採用している（`scripts/check-file-size.py`）。ベースライン登録済みファイルは記録値を 1 行でも超えたら FAIL、未登録ファイルは予算を超えたら FAIL。

- **赤くなったときの対処の分岐**:
  - **分割して全ファイルが予算内** → `--update` でベースラインの縮小・陳腐エントリ削除を反映
  - **予算超過のままリネーム** → `scripts/file-size-baseline.json` のキー名だけを手編集（値は据え置き）
  - **既存ファイルが単に伸びた** → 分割するか、やむを得なければ値を手編集して理由を PR に書く
- 拡大が必要な場合は `--update` や全面再生成ではなく、該当エントリを手編集し、理由を PR に書くこと

## lint 失敗時の対応

1. `lint.sh` のエラー出力から問題箇所と原因を読み取る
2. 該当ファイルを手動で修正する（`--fix` や `prettier --write` / `ruff format` 等の自動修正モードは使わない）
3. `scripts/lint.sh {対象コンポーネント}` を再実行して確認
4. lint が通ったら中断していた `scripts/test.sh` を再実行

最大 3 回修正を試みても解決しない場合は、エラー内容をユーザーに報告して判断を仰ぐ。lint 失敗を無視してテストやコミットに進んではならない。
