# Jupyter（server + mcp + ai-sync）

コード実行、セッション管理、SQL、画像、AI同期に関する Phase。

完了した Phase 1〜24 は [archive/01-jupyter.md](archive/01-jupyter.md) を参照。

---

## Phase 20: 実行制御の環境変数化とカーネル上限

要件定義済みだが未実装の実行制御機能。詳細は `docs/requirements/jupyter-server.md` を参照。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 20.1 | 環境変数 `EXECUTION_TIMEOUT` 対応 | [ ] | `EXECUTION_TIMEOUT=10` で起動し、10秒超のコード実行がタイムアウトする | 現在はAPIパラメータのデフォルト30秒をハードコード |
| 20.2 | 環境変数 `MAX_OUTPUT_SIZE` 対応 | [ ] | `MAX_OUTPUT_SIZE` を小さく設定し、超過する出力が切り詰められる | NF1で1MB/実行と定義 |
| 20.3 | 同時カーネル上限の強制 | [ ] | 上限（5カーネル）到達後の session_create がエラーになる | F1.1で定義、未実装 |

---

## Phase 25: jupyter-mcp 境界検証・エラー分類の残債

Phase 22（jupyter-mcp 構造改善）で主要部分は解消したが、境界のランタイム検証（不変条件 I4）と接続断の扱いに残債がある。2026-07-31 の §4〜§5 再調査で未解消と確認したもの。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 25.1 | session-resolver: 接続断とリソース未発見の区別 | [ ] | jupyter-server 停止中に session 系ツールを呼ぶと「接続不可」と分かるエラーが返り、存在しない session_id の場合と区別できる | `utils/session-resolver.ts:55-61` が listSessions 失敗時に stale キャッシュへフォールバックし、再起動後に誤誘導する |
| 25.2 | jupyter-client の未検証レスポンスへの zod 適用 | [ ] | 契約違反のレスポンスを返すモックに対し、「形式不正」と分かるエラーが返る（`Cannot read properties of undefined` にならない） | `jupyter-client/client.ts` の `getVariable` / `getFileContent` が `validateResponse` を経由していない。不変条件 I4 |
