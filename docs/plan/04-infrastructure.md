# Infrastructure

テスト、ビルド、データロード、Formatter に関する Phase。

完了した Phase 1〜9 は [archive/04-infrastructure.md](archive/04-infrastructure.md) を参照。

---

## Phase 10: コンテキスト管理の改善

AIエージェントが読み込むコンテキストの削減と、ドキュメント陳腐化の防止（「コードが正」の徹底）を行う Phase。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 10.1 | 完了タスクのアーカイブ構造導入 | [→] | docs/plan・docs/tasks・docs/issues の完了分が archive/ に退避され、現役ファイルに進行中・未着手のみ残る | plan/README.md にアーカイブ規約を明文化。関連コマンド・スキル・ルールの参照更新を含む |
| 10.2 | SSoT 再定義（コードが正）とポインタ化 | [ ] | STRUCTURE.md の SSoT 表で実装詳細の正がコードになり、*/CLAUDE.md・README.md のツール/API一覧がコードへのポインタに置き換わる | documentation.md / doc-code-audit スキルの判定基準も同期 |
| 10.3 | requirements / api-contracts のスリム化 | [ ] | 要件定義と API 仕様から実装詳細（スキーマ・デフォルト値等）が除去され、F番号・Why・受け入れ条件・機械検証可能な一覧表のみ残る | コード照合で乖離を検証しながら実施 |
| 10.4 | ドキュメント整合性の CI 機械検証 | [ ] | PR ごとに CI で MCPツール名・エンドポイント・Markdownリンクの整合が検証され、乖離があると FAIL する | scripts/check-docs-consistency.py + ci.yml ジョブ追加 |
| 10.5 | カスタムコマンドの DRY 化と常時ロード削減 | [ ] | commands の重複手順が skills へ抽出され、scripts.md が条件付きロードになる | CLAUDE.md にスクリプト利用のポインタ行を残す |
