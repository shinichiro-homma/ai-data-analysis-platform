---
paths:
  - "docs/requirements/**"
  - "docs/design/api-contracts.md"
  - "docs/overview.md"
---

# 要件変更ワークフロー

要件変更は必ず以下の2ステップで行う。影響範囲の洗い出しと変更適用を分離することで、変更漏れや不整合を防ぐ。

## 必須ワークフロー

1. `/custom-change-requirement` で影響範囲を洗い出す（ファイル変更は行わない）
2. `/custom-apply-change` で変更を適用する（コミット＆プッシュまで完了させる）

`/custom-apply-change` はコミット＆プッシュ完了まで終了とみなさない。適用後、PR を作成するか同じブランチで開発を継続するかをユーザーに確認する。

## 例外: コード追従によるドキュメント修正

`complete-task` / `auto-audit-docs` でコードとドキュメントの乖離を検出した場合、**コードが正（SSoT）であるため**、ドキュメント側をコードに合わせる修正は `/custom-change-requirement` → `/custom-apply-change` を経由せず直接修正してよい。

適用条件：
- 修正の方向が「コード → ドキュメント」であること
- 実装済みコードへの追従であり、要件の意図的変更でないこと

要件自体を変更する場合（新機能追加、仕様変更等）は必須ワークフローを経ること。

## 禁止事項

- `/custom-change-requirement` 実行後に `/custom-apply-change` を使わず直接編集すること
- `/custom-apply-change` を `/custom-change-requirement` なしに単独実行すること
- 要件定義ドキュメント（`docs/requirements/*.md`、`docs/overview.md`、`docs/design/api-contracts.md`）を上記ワークフローを経ずに直接変更すること（例外該当を除く）
