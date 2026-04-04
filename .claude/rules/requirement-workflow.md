# 要件変更ワークフロー

要件変更は、必ず以下の2ステップで行うこと。

## 必須ワークフロー

1. `/custom-change-requirement` で影響範囲を洗い出す（ファイル変更は行わない）
2. `/custom-apply-change` で変更を適用する（コミット＆プッシュまで完了させる）

`/custom-apply-change` はコミット＆プッシュが完了するまで終了とみなさない。

## 禁止事項

- `/custom-change-requirement` を実行した後に、`/custom-apply-change` を使わず直接ファイルを編集すること
- `/custom-apply-change` を `/custom-change-requirement` の実行なしに単独で実行すること
- 要件定義ドキュメント（`docs/requirements/*.md`、`docs/overview.md`、`docs/design/api-contracts.md`）を、上記ワークフローを経ずに直接変更すること

## 理由

影響範囲の洗い出しと変更適用を分離することで、変更漏れや不整合を防ぐ。
