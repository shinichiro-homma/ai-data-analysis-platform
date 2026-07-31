# Document（server + mcp）

カタログ、用語集、ロジック、コンテキストエンジニアリングに関する Phase。

完了した Phase 1〜7・9 は [archive/02-document.md](archive/02-document.md) を参照。

---

## Phase 8: ツール呼び出しログ（NF3）

要件定義済みだが未実装のログ出力。詳細は `docs/requirements/document-mcp.md` を参照。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 8.1 | document-mcp: 全ツール呼び出しのログ出力 | [ ] | ツール呼び出しの開始・完了・エラーがログに出力される | logger.ts は存在するがツール実行層で未使用 |

---

## Phase 10: document-mcp の境界ランタイム検証（I4）

jupyter-mcp では Phase 22 で zod による境界検証を導入したが、document-mcp には横展開されていない。2026-07-31 の §5 再調査で未着手と確認したもの。不変条件 I4（プロセス境界を越えるデータは境界でランタイム検証する）の既知違反。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 10.1 | document-client のレスポンスに zod 検証を導入 | [ ] | document-server が契約違反のレスポンスを返した場合、「形式不正」と分かるエラーが返る（`Cannot read properties of undefined` にならない） | `document-client/client.ts:71-78` の `request<T>` が `response.data.data` を無検証キャストしている。`zod` 依存の追加が必要。jupyter-mcp の `jupyter-client/schemas.ts` が実装の参考 |
