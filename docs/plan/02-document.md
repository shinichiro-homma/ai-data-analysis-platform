# Document（server + mcp）

カタログ、用語集、ロジック、コンテキストエンジニアリングに関する Phase。

完了した Phase 1〜7 は [archive/02-document.md](archive/02-document.md) を参照。

---

## Phase 8: ツール呼び出しログ（NF3）

要件定義済みだが未実装のログ出力。詳細は `docs/requirements/document-mcp.md` を参照。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 8.1 | document-mcp: 全ツール呼び出しのログ出力 | [ ] | ツール呼び出しの開始・完了・エラーがログに出力される | logger.ts は存在するがツール実行層で未使用 |

---

## Phase 9: document-server 改善

`tmp/refactor-notes.md` §3 で指摘された document-server の負債解消（大規模リファクタリング S7）。低優先の §3-5（用語検索の線形走査・detail ディレクトリ欠損の検知遅れ）と §3-6（新ルーター追加時の protected_router 登録忘れ）はスコープ外とする。9.1 と 9.3 は同じ `admin.py` を触るため 9.1 → 9.2 → 9.3 の順に直列で進める。各タスクの詳細計画は着手時に `/custom-plan-task` で個別に作成する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 9.1 | /admin/reload の copy-on-write アトミック化 | [→] | reload が途中失敗（YAML 構文エラー等）しても既存 API は旧カタログを返し続け、成功時のみ新カタログへ切り替わる（不正入力・並行の異常系） | 新ストアを構築してから `app.state` の参照をアトミックに差し替える。並行 reload はロックで直列化（§3-1、invariants I6） |
| 9.2 | YAML エラー処理の統一と /health 可視化 | [ ] | 不正な YAML ファイル（構文エラー・必須キー欠損）の reload/起動時の扱いが統一され、スキップ件数が /health で確認できる（不正入力） | 構文エラー=全体失敗 / id_field 欠損=警告スキップ / その他必須キー欠損=全体失敗の非対称を解消（§3-2） |
| 9.3 | エラーレスポンス機構の統一 | [ ] | エラー時も `{"error": {...}}` 形式が維持されたまま `dict \| JSONResponse` 戻り値が解消され、OpenAPI にレスポンス型が復活する。Pydantic ValidationError が INTERNAL_ERROR ではなくデータ不正として分類される（不正入力） | exception_handler ベースへ統一（`admin.py` / `logic.py` の `response_model=None` 解消、§3-3/3-4） |
