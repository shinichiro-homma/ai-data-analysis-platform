# スクリプト利用ルール

ビルド・テスト・Docker 操作には `scripts/` 配下のスクリプトを使うこと。
個別に `npm run build`、`npm run typecheck`、`npm test`、`docker-compose build` 等を直接実行しない。

## スクリプト一覧

| スクリプト | 用途 | 例 |
|-----------|------|-----|
| `scripts/test.sh [COMPONENT]` | 型チェック + テスト | `scripts/test.sh jupyter-mcp` |
| `scripts/test.sh --rebuild [COMPONENT]` | リビルド + テスト（MCP/Docker 自動判定） | `scripts/test.sh --rebuild jupyter-mcp` |
| `scripts/test.sh --integration [COMPONENT]` | 統合テスト（Docker 環境必要） | `scripts/test.sh --integration jupyter-mcp` |
| `scripts/smoke-test.sh` | Docker 環境のスモークテスト | `scripts/smoke-test.sh` |
| `scripts/check-freshness.sh` | Docker 環境の鮮度チェック | `scripts/check-freshness.sh` |
| `scripts/rebuild-mcp.sh [SERVER]` | MCP サーバーのビルド | `scripts/rebuild-mcp.sh jupyter-mcp` |
| `scripts/rebuild.sh [SERVICE]` | Docker コンテナのリビルド・起動（postgres データ自動更新付き、MCP は含まない） | `scripts/rebuild.sh jupyter-server` |
| `scripts/rebuild.sh --verify` | リビルド後にスモークテスト実行 | `scripts/rebuild.sh --verify` |
| `scripts/switch-env.sh [ENV]` | データ環境の切り替え（既存データありならスキップ確認） | `scripts/switch-env.sh production` |
| `scripts/switch-env.sh --force-reload [ENV]` | データ環境の切り替え（強制再ロード） | `scripts/switch-env.sh --force-reload production` |
| `scripts/test.sh --health [COMPONENT]` | テスト後に既知障害と照合して分類 | `scripts/test.sh --health jupyter-mcp` |
| `scripts/manage-known-failures.sh COMMAND` | 既知テスト失敗の管理（CRUD） | `scripts/manage-known-failures.sh list` |
| `scripts/create-test-issue.sh` | テスト失敗の GitHub Issue 起票 | `scripts/create-test-issue.sh --component jupyter-mcp --test-name "test" --add-known` |
| `scripts/generate-init-scripts.sh [ENV]` | カタログYAMLからDB初期化スクリプトを自動生成 | `scripts/generate-init-scripts.sh sample` |
| `scripts/convert-csv-to-parquet.py [ENV]` | CSV→Parquet変換（既存Parquetはスキップ、`--force`で再変換） | `scripts/convert-csv-to-parquet.py production` |
| `scripts/clean-rebuild.sh` | 全削除→クリーンビルド→動作確認 | `scripts/clean-rebuild.sh --env sample -y` |
| `scripts/promote-to-main.sh` | dev → main プロモーション PR 作成 | `scripts/promote-to-main.sh` |
| `scripts/cleanup-merged-branches.sh` | dev にマージ済みのローカル feature/fix ブランチを削除 | `scripts/cleanup-merged-branches.sh` |

## よく使うパターン

```bash
# リビルド + テスト（推奨: MCP/Docker を自動判定）
scripts/test.sh --rebuild jupyter-mcp
scripts/test.sh --rebuild document-server

# コード変更後のテスト（リビルドなし）
scripts/test.sh jupyter-mcp

# MCP サーバーのリビルド（コード変更を反映）
scripts/rebuild-mcp.sh jupyter-mcp

# Docker コンテナのリビルド（Dockerfile や依存変更時）
scripts/rebuild.sh jupyter-server

# postgres データの再初期化（Parquet/YAML 変更後に自動検出）
scripts/rebuild.sh                        # 全サービス: データが古い場合のみ再初期化
scripts/rebuild.sh postgres               # postgres 明示指定: 常に再初期化
scripts/rebuild.sh --clean                # --clean: 常に再初期化

# 型チェックのみ
scripts/test.sh --typecheck jupyter-mcp

# 全コンポーネントのテスト
scripts/test.sh

# データ環境の切り替え（既存データがあれば確認プロンプト表示）
scripts/switch-env.sh production
scripts/switch-env.sh sample
scripts/switch-env.sh -y production             # 確認なし（データがあれば再ロードしない）
scripts/switch-env.sh --force-reload production  # 強制再ロード

# 統合テスト（Docker 環境が必要）
scripts/test.sh --integration jupyter-mcp

# 統合テスト + リビルド（sample 環境に自動切り替え + 鮮度チェック）
scripts/test.sh --integration --rebuild
scripts/test.sh --integration --rebuild jupyter-mcp

# Docker 環境のスモークテスト
scripts/smoke-test.sh

# リビルド後にスモークテスト
scripts/rebuild.sh --verify

# 環境の鮮度チェック
scripts/check-freshness.sh
scripts/check-freshness.sh --strict    # 古い場合は exit 1
scripts/check-freshness.sh --rebuild   # 古い場合は自動リビルド

# テスト後に既知障害と照合
scripts/test.sh --health jupyter-mcp

# 既知テスト失敗の管理
scripts/manage-known-failures.sh list
scripts/manage-known-failures.sh add --component jupyter-mcp --test-name "test name" --reason "理由"
scripts/manage-known-failures.sh remove --id kf-001
scripts/manage-known-failures.sh check jupyter-mcp

# カタログYAMLからDB初期化スクリプトを自動生成
scripts/generate-init-scripts.sh sample
scripts/generate-init-scripts.sh production

# CSV→Parquet変換（仮置きCSVからParquetを生成）
scripts/convert-csv-to-parquet.py sample
scripts/convert-csv-to-parquet.py production
scripts/convert-csv-to-parquet.py --force production  # 既存Parquetも再変換

# dev → main プロモーション（PR 作成）
scripts/promote-to-main.sh
scripts/promote-to-main.sh --dry-run   # 除外されるファイルの確認のみ

# MCP + Docker 全コンポーネント一括更新（インクリメンタル、2-3分）
scripts/rebuild-mcp.sh && scripts/rebuild.sh

# 完全クリーンビルド（全削除→MCP+Docker ビルド→スモークテスト）
scripts/clean-rebuild.sh                    # 確認あり（.env の環境を使用）
scripts/clean-rebuild.sh --env sample -y    # sample 環境で確認なし実行
scripts/clean-rebuild.sh --env production   # production 環境で実行
scripts/clean-rebuild.sh --keep-volumes     # DB データを保持してリビルド
scripts/clean-rebuild.sh --skip-smoke       # スモークテストなし
scripts/clean-rebuild.sh --skip-mcp        # MCP ビルドをスキップ（Docker のみ再構築）
```

## Docker ゴミ溜まり対策

以下のスクリプトは実行時に自動で Docker のゴミ（dangling イメージ、ビルドキャッシュ、orphaned ボリューム）を削除する。

| スクリプト | 対策内容 |
|-----------|---------|
| `scripts/clean-rebuild.sh` | `image prune` + `builder prune` + `volume prune` |
| `scripts/rebuild.sh` | `image prune` + `builder prune` + `volume prune`（リビルド後） |
| `scripts/switch-env.sh` | `image prune` + `volume prune`（環境切り替え時） |

`.dockerignore` により、ビルドコンテキストから `node_modules/`、`dist/`、`.git/`、`docs/`、`tests/` 等を除外している。

## 理由

1 回のスクリプト呼び出しで完結するため、ツール呼び出し回数とトークン消費を削減できる。
