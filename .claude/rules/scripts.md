---
paths:
  - "scripts/**"
  - "**/package.json"
  - "docker-compose.yml"
  - "**/Dockerfile"
  - ".github/workflows/**"
---

# スクリプト利用ルール

ビルド・テスト・Docker 操作には `scripts/` 配下のスクリプトを使うこと。
`npm run build` / `npm run typecheck` / `npm test` / `docker compose build` 等を直接実行しない。

## スクリプト一覧

| スクリプト | 用途 | 主なオプション |
|-----------|------|----------------|
| `scripts/bootstrap.sh` | 初回セットアップ（uv 検知 → uv sync → git config → .env 初期化） | — |
| `scripts/lint.sh [COMPONENT]` | lint チェック（検出のみ） | — |
| `scripts/test.sh [COMPONENT]` | lint + 型チェック + テスト | `--no-lint` / `--typecheck`（型のみ）/ `--rebuild`（MCP・Docker 自動判定）/ `--integration`（Docker 必要、`--rebuild` と併用可）/ `--health`（既知障害と照合して分類） |
| `scripts/smoke-test.sh` | Docker 環境のスモークテスト | — |
| `scripts/check-freshness.sh` | Docker 環境の鮮度チェック | `--strict`（古いと exit 1）/ `--rebuild`（古ければ自動リビルド） |
| `scripts/check-docs-consistency.py` | ドキュメント整合性の機械検証（MCPツール名・エンドポイント・リンク切れ。CI でも常時実行） | `uv run python scripts/check-docs-consistency.py` で実行 |
| `scripts/rebuild-mcp.sh [SERVER]` | MCP サーバーのビルド | — |
| `scripts/rebuild.sh [SERVICE]` | Docker コンテナのリビルド・起動（postgres データ自動更新付き、MCP は含まない） | `postgres`（DB のみ再初期化）/ `--clean`（常に再初期化）/ `--verify`（完了後にスモークテスト） |
| `scripts/switch-env.sh [ENV]` | データ環境の切り替え（既存データありならスキップ確認） | `--force-reload`（強制再ロード） |
| `scripts/manage-known-failures.sh COMMAND` | 既知テスト失敗の管理（CRUD） | `list` / `add --component ... --test-name ... --reason ...` / `remove --id kf-001` / `check {COMPONENT}` |
| `scripts/manage-workspaces.sh COMMAND` | jupyter-server ワークスペースの管理（再帰削除対応） | `list` / `delete {WORKSPACE_ID}` / `delete-all`（`-y` 確認スキップ、`--dry-run` 対象表示のみ、`--jupyter-url URL` で上書き可） |
| `scripts/create-test-issue.sh` | テスト失敗の GitHub Issue 起票 | `--component ... --test-name ... --add-known` |
| `scripts/generate-init-scripts.sh [ENV]` | カタログ YAML から DB 初期化スクリプトを生成 | — |
| `scripts/convert-csv-to-parquet.py [ENV]` | CSV → Parquet 変換（既存はスキップ） | `--force`（再変換） |
| `scripts/clean-rebuild.sh` | 全削除 → クリーンビルド → 動作確認 | `--env sample` / `-y` / `--keep-volumes`（DB 保持）/ `--skip-smoke` / `--skip-mcp` |
| `scripts/promote-to-main.sh` | dev → main プロモーション PR 作成 | — |
| `scripts/cleanup-merged-branches.sh` | 不要ブランチの一括掃除（prune + ローカル + promote） | `--all` |

MCP と Docker 全コンポーネントを一括更新する場合は `scripts/rebuild-mcp.sh && scripts/rebuild.sh`。
