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
