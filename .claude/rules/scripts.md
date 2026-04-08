# スクリプト利用ルール

ビルド・テスト・Docker 操作には `scripts/` 配下のスクリプトを使うこと。
個別に `npm run build`、`npm run typecheck`、`npm test`、`docker-compose build` 等を直接実行しない。

## スクリプト一覧

| スクリプト | 用途 | 例 |
|-----------|------|-----|
| `scripts/lint.sh [COMPONENT]` | lint / format チェック（検出のみ） | `scripts/lint.sh jupyter-mcp` |
| `scripts/test.sh [COMPONENT]` | lint + 型チェック + テスト | `scripts/test.sh jupyter-mcp` |
| `scripts/test.sh --no-lint [COMPONENT]` | 型チェック + テスト（lint スキップ） | `scripts/test.sh --no-lint jupyter-mcp` |
| `scripts/test.sh --rebuild [COMPONENT]` | リビルド + lint + テスト（MCP/Docker 自動判定） | `scripts/test.sh --rebuild jupyter-mcp` |
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
| `scripts/cleanup-merged-branches.sh` | 不要ブランチの一括掃除（prune + ローカル + promote） | `scripts/cleanup-merged-branches.sh --all` |

## 補足オプション（テーブルに含まれないもの）

```bash
# test.sh の追加オプション
scripts/test.sh --typecheck jupyter-mcp          # 型チェックのみ
scripts/test.sh --integration --rebuild jupyter-mcp  # 統合テスト + リビルド

# rebuild.sh の追加オプション
scripts/rebuild.sh postgres                      # postgres のみ再初期化
scripts/rebuild.sh --clean                       # 常に再初期化

# check-freshness.sh の追加オプション
scripts/check-freshness.sh --strict              # 古い場合は exit 1
scripts/check-freshness.sh --rebuild             # 古い場合は自動リビルド

# clean-rebuild.sh の追加オプション
scripts/clean-rebuild.sh --keep-volumes          # DB データを保持してリビルド
scripts/clean-rebuild.sh --skip-smoke            # スモークテストなし
scripts/clean-rebuild.sh --skip-mcp              # MCP ビルドをスキップ

# manage-known-failures.sh のサブコマンド
scripts/manage-known-failures.sh add --component jupyter-mcp --test-name "test name" --reason "理由"
scripts/manage-known-failures.sh remove --id kf-001

# 一括更新
scripts/rebuild-mcp.sh && scripts/rebuild.sh     # MCP + Docker 全コンポーネント
```

## 禁止事項

`npm run build`、`npm run typecheck`、`npm test`、`docker-compose build` 等を直接実行しない。必ず `scripts/` 配下のスクリプトを使うこと。
