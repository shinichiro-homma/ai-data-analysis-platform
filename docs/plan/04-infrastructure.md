# Infrastructure

テスト、ビルド、データロード、Formatter に関する Phase。

完了した Phase 1〜10, 12〜13 は [archive/04-infrastructure.md](archive/04-infrastructure.md) を参照。

---

## Phase 11: 負債予防の開発プロセス整備

機能単位開発の盲点（どの機能にも属さない性質の放置）を制度で塞ぐ Phase。背景は `docs/design/invariants.md` と `docs/adr/0001` を参照。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 11.1 | ADR・横断不変条件・タスク設計ルールの整備 | [x] | 計画作成時に異常系AC・不変条件・ADR要否のチェックが要求され、/custom-debt-review で横断監査が実行できる | docs/adr/（テンプレ+0001）、docs/design/invariants.md（I1〜I8）、task-design.md チェックリスト拡張、change-requirement に異常系レンズ追加 |
| 11.2 | ruff ASYNC ルールの有効化 | [x] | async 関数内のブロッキング I/O を含む PR で `scripts/lint.sh jupyter-server` が exit 1 になる | 不変条件 I3 の機械検知。CI 変更は不要（既存 python-lint-and-test が拾う）。既存違反 5 件は実測済み |
| 11.3 | ファイルサイズ予算の CI 検知 | [ ] | 予算超過ファイルを含む PR で CI の fitness-functions ジョブが FAIL する | ラチェット方式（現状をベースライン化し悪化のみブロック）。ベースラインは 11.2 完了後に採取する |
| 11.4 | コピペ検出（jscpd・informational） | [ ] | 重複率が閾値を超えた PR で jscpd ステップが赤くなる（CI はブロックしない） | 不変条件 I8 の可視化。誤検知の切り分け期間として informational から開始する |

> Phase 11.2〜11.4 の分割根拠と実測ベースラインは `docs/tasks/archive/infrastructure/11.2-ruff-async-rules.md` の「背景: 3ゲートの実測」を参照。

