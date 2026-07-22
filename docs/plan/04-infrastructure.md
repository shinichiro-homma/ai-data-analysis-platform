# Infrastructure

テスト、ビルド、データロード、Formatter に関する Phase。

完了した Phase 1〜10, 12 は [archive/04-infrastructure.md](archive/04-infrastructure.md) を参照。

---

## Phase 11: 負債予防の開発プロセス整備

機能単位開発の盲点（どの機能にも属さない性質の放置）を制度で塞ぐ Phase。背景は `docs/design/invariants.md` と `docs/adr/0001` を参照。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 11.1 | ADR・横断不変条件・タスク設計ルールの整備 | [x] | 計画作成時に異常系AC・不変条件・ADR要否のチェックが要求され、/custom-debt-review で横断監査が実行できる | docs/adr/（テンプレ+0001）、docs/design/invariants.md（I1〜I8）、task-design.md チェックリスト拡張、change-requirement に異常系レンズ追加 |
| 11.2 | CI 適応度関数（構造予算の機械検知） | [ ] | ファイルサイズ予算超過・async 内ブロッキング I/O（ruff ASYNC ルール）・コピペ検出が CI で検知される | 既存違反（handlers.py 1,515行等）の解消とセットで有効化。リファクタ Phase と同時に計画する |

---

## Phase 13: npm 依存パッケージの脆弱性修正

npm audit で検出された high/moderate 脆弱性の解消。CI の npm audit (informational) ジョブを pass させ、PR の `mergeStateStatus` が `UNSTABLE` にならないようにする。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 13.1 | npm 依存パッケージの脆弱性修正 | [ ] | `npm audit --audit-level=high` が exit 0 で終了する。CI の npm audit (informational) ジョブが pass する | `fast-uri` 3.0.0-3.1.3 (high: host confusion via backslash)、`@hono/node-server` <2.0.5 (moderate: path traversal on Windows, `@modelcontextprotocol/sdk` 経由の間接依存) |

