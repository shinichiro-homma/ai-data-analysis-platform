# Document（server + mcp）

カタログ、用語集、ロジック、コンテキストエンジニアリングに関する Phase。

完了した Phase 1〜7 は [archive/02-document.md](archive/02-document.md) を参照。

---

## Phase 8: ツール呼び出しログ（NF3）

要件定義済みだが未実装のログ出力。詳細は `docs/requirements/document-mcp.md` を参照。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 8.1 | document-mcp: 全ツール呼び出しのログ出力 | [ ] | ツール呼び出しの開始・完了・エラーがログに出力される | logger.ts は存在するがツール実行層で未使用 |
