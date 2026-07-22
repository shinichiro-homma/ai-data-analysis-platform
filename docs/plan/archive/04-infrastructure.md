# Infrastructure — アーカイブ

> **完了済み Phase の記録。** 進行中・未着手のタスクは [../04-infrastructure.md](../04-infrastructure.md) を参照。本文中の詳細計画への参照は `docs/tasks/archive/infrastructure/` に読み替えること。

<!-- Phase は番号順に並べる。新しい Phase はファイル末尾に追記する -->

---

## Phase 1: Jupyter統合テスト

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 1.1 | 単体テスト整備 | [x] | 全ツールのユニットテストが通る | 144テスト成功 |
| 1.2 | MCP Inspector での動作確認 | [x] | 全ツールがInspectorで表示・実行可能 | |
| 1.3 | Claude Desktop での動作確認 | [x] | Claude Desktopから接続して分析フロー実行可能 | |

---

## Phase 2: 全体統合

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 2.1 | docker-compose 統合 | [x] | 全コンポーネントが同時起動 | docker-compose.yml をルートに統合、document-server Dockerfile 作成 |
| 2.2 | E2Eテストシナリオ作成・実行 | [x] | カタログ参照→分析実行の完全フロー | 11テスト成功（5シナリオ） |
| 2.3 | パフォーマンス確認 | [x] | 応答時間が要件を満たす | 19テスト成功（E2E 7 + doc-mcp 7 + jup-mcp 5） |
| 2.4 | ドキュメント最終整備 | [x] | README等 | README.md 全面拡充、jupyterlab-ai-sync README 日本語化 |

---

## Phase 3: 動作確認・検証

全機能が統合された状態での動作確認と検証。MCPクライアント（Claude Desktop / Claude Code）からの実際の操作で、主要ユースケースが正常に動作することを確認する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 3.1 | エンドツーエンド分析フローの動作確認 | [x] | ワークスペース作成→カタログ参照→SQL実行→データ取得→Python分析→グラフ生成の一連フローがMCPクライアントから正常に動作する | Claude Desktop または Claude Code から実施 |
| 3.2 | AIリアルタイム同期の動作確認 | [x] | ブラウザでJupyterLabを表示しながら、AI編集モード→セル追加→コード実行→結果表示→アンロックがリアルタイムに反映される | ブラウザ目視確認を含む |
| 3.3 | ワークスペース分離の動作確認 | [x] | 複数ワークスペースで独立した分析を同時実行し、データ・セッションが相互に分離されていることを確認する | MCP再起動後の再発見も確認 |

---

## Phase 4: ドキュメント・コード整合性修正 v2

複数回の機能実装に伴うドキュメント・コード間の不整合を修正し、要件定義・API仕様・実装を統一的に整える Phase。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 4.1 | jupyter-mcp ドキュメント整合 | [x] | - | execute_code エラーレスポンス（ネスト形式）、画像URI（sessions複数形）、get_dataframe_info（success/name追加）、execute_code timeout最大値記載追加 |
| 4.2 | document-server ドキュメント・コード整合 | [x] | - | DataSource CSV型対応（models.py）、未使用エラーコード削除（TABLE_NOT_FOUND/TERM_NOT_FOUND）、INTERNAL_ERROR追加 |
| 4.3 | document-mcp ドキュメント整合 | [x] | - | インデックス系3ツールの戻り値に success フィールド追加、get_table_index description をコード実装に統一 |
| 4.4 | jupyter-server ドキュメント整合 | [x] | - | CLAUDE.md API一覧（restart/variables/{name}/contents CRUD）・ライブラリリスト更新 |
| 4.5 | jupyterlab-ai-sync ドキュメント整合 | [x] | - | イベントペイロード、WebSocket仕様、パス解決、空セル置換、trusted設定、ロック動作の文書化 |

---

## Phase 5: テーブル追加フロー自動化

カタログ YAML を Single Source of Truth として、PostgreSQL の init スクリプト（CREATE TABLE / COPY）を自動生成する仕組み。postgres/init/ を環境別（sample/production）に分離し、テーブル追加時の手作業を排除する。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 5.1 | postgres/init 環境別分離 + ディスパッチャー | [x] | `DATA_ENV=sample` で `postgres/init/sample/` のスクリプトが実行され、`DATA_ENV=production` で `postgres/init/production/` のスクリプトが実行される | postgres/init/ を環境別に分離、01-init-db.sh ディスパッチャー作成、.gitignore に postgres/init/production/ 追加 |
| 5.2 | init スクリプト自動生成スクリプト | [x] | `scripts/generate-init-scripts.sh sample` を実行すると、カタログ YAML から `postgres/init/sample/create-tables.sql` と `postgres/init/sample/load-data.sh` が生成され、`switch-env.sh` で PostgreSQL が正常にデータをロードする | Python スクリプトで YAML パース → SQL/SH 生成。日本語カラム名のダブルクォート対応 |
| 5.3 | /custom-sync-db カスタムコマンド | [x] | `/custom-sync-db sample` を実行すると、init スクリプト再生成 → PostgreSQL ボリューム削除 → 再構築 → スモークテストが一括実行される | .claude/commands/custom-sync-db.md 作成 |
| 5.4 | テーブル追加ガイド・ドキュメント更新 | [x] | docs/guides/add-table.md が新フロー（CSV配置 → カタログYAML作成 → /custom-sync-db 実行）に更新されている | docs/COMMANDS.md、.claude/rules/scripts.md も更新 |

---

## Phase 6: ビルド・デプロイパイプライン整備

開発したソースコード・YAML ドキュメントデータが環境に正しく反映されない問題を根本解決する。鮮度チェックスクリプトのバグ修正、スクリプト間の重複排除、カスタムコマンドへのリビルド強制組み込み、YAML 変更の自動検出を行う。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 6.1 | check-freshness.sh のバグ修正 | [x] | `check-freshness.sh` が Docker コンテナの鮮度を正しく検出する（SKIP にならない） | `docker compose ps -q` でコンテナ ID を動的解決。`container_epoch` 関数の修正 |
| 6.2 | スクリプト間の重複排除・統合 | [x] | `clean-rebuild.sh` が `rebuild-mcp.sh` を呼び出して MCP ビルドを実行する（インライン実装でない） | `clean-rebuild.sh` のインライン MCP ビルドを `rebuild-mcp.sh` 呼び出しに置換 |
| 6.3 | カスタムコマンドへのリビルド強制組み込み | [x] | `start-task`, `start-fix`, `refactor` がリビルド付きテスト（`--rebuild`）を実行する | `complete-task` にもテスト再実行を追加 |
| 6.4 | test.sh の --rebuild 改善 | [x] | `scripts/test.sh --rebuild jupyter-mcp` で MCP リビルド + テストが一括実行される。通常テストでも `--rebuild` が有効 | MCP/Docker を自動判定、`--integration` と独立動作 |
| 6.5 | YAML データ変更の自動検出・反映 | [x] | YAML 変更後に `check-freshness.sh` が document-server data の STALE を報告する。`--rebuild` で自動反映 | document-server data の鮮度チェック項目追加、postgres-init の `--rebuild` 時に `switch-env.sh` も連鎖実行 |
| 6.6 | ルールとドキュメントの整合性更新 | [x] | - | `rebuild-before-test.md`, `freshness-check.md`, `scripts.md` の更新 |
| 6.7 | rebuild.sh の postgres データ自動更新 | [x] | `touch postgres/data/sample/*.csv && scripts/rebuild.sh` で postgres が再初期化される。`rebuild.sh jupyter-server` では postgres はスキップされる | postgres の鮮度チェック＋再初期化を rebuild.sh に組み込み |

---

## Phase 7: PostgreSQL データロード形式の変更（CSV → Parquet）

CSV ベースのデータロードを Parquet ベースに変更し、ストレージ効率を改善する。CSV（61GB）を Parquet（推定 5-10GB）に圧縮してローカルに配置し、Python で Parquet → メモリ内変換 → COPY FROM STDIN で PostgreSQL に直接ロードする。データロードはホスト側から実行（postgres コンテナ内に Python は不要）。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 7.1 | CSV → Parquet 変換スクリプト | [x] | `scripts/convert-csv-to-parquet.py sample` で `postgres/data/csv/sample/*.csv` → `postgres/data/sample/*.parquet` に変換される。既存 Parquet はスキップ、`--force` で再変換 | pyarrow 使用。CSV 仮置きディレクトリ `postgres/data/csv/` を新設 |
| 7.2 | generate-init-scripts.sh の .py 生成対応 | [x] | `scripts/generate-init-scripts.sh sample` で `postgres/init/sample/load-data.py` が生成される（`load-data.sh` 廃止） | generate_init.py の generate_load_data() を Python スクリプト生成に書き換え |
| 7.3 | postgres init スクリプトと DB ロードフローの変更 | [x] | `scripts/rebuild.sh postgres` で (1) create-tables.sql をコンテナ内で実行 (2) load-data.py をホスト側から実行し、Parquet データが PostgreSQL にロードされる | 01-init-db.sh から load-data 実行を削除、rebuild.sh / switch-env.sh にホスト側ロードを追加 |
| 7.4 | 鮮度チェックの Parquet 対応 | [x] | `check-freshness.sh` / `rebuild.sh` が `*.parquet` ファイルの更新を検出する | `*.csv` → `*.parquet`、`*.sh` → `*.py` の参照変更 |
| 7.5 | 既存データの Parquet 移行と動作確認（sample） | [x] | sample 環境で CSV 削除 → Parquet のみで DB ロード → スモークテストが通る。generate_init.py が Parquet なしテーブルの CREATE TABLE をスキップする | sample CSV を git rm、generate_init.py に Parquet 存在チェック追加 |
| 7.6 | production 環境の大容量データロード対応 | [x] | production 環境で `switch-env.sh production` → スモークテストが通る。`dm_purchase_history`（56M行）等の大容量テーブルがロードできる | load-data.py のチャンク分割ロード実装。テーブルごとコミット済み（7.5）だが、単一テーブルが大きすぎてメモリ不足になる問題への対応 |
| 7.7 | データロード速度の最適化 | [x] | sample/production 環境で `switch-env.sh` → スモークテストが通る。ロード時間が最適化前より短縮される | PostgreSQL チューニング、文字列クリーニング最適化、CHUNK_SIZE 拡大、テーブル単位コミット |

---

## Phase 8: Linter / Formatter 適用

ruff（Python）と prettier（TypeScript）のフォーマッターを既存コードに適用する。設定ファイルは追加済み（`pyproject.toml` の `[tool.ruff]`、`.prettierrc`）。コンポーネントごとにフォーマット適用 → テスト → コミットを繰り返し、問題があればステップ単位で切り戻せるようにする。

### フェーズ 1: 小規模コンポーネント

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 8.1 | jupyterlab-ai-sync の prettier 適用 | [x] | ビルド（`tsc`）が通る | src/ 8ファイル |
| 8.2 | jupyter-server の ruff 適用 | [x] | `scripts/test.sh --rebuild jupyter-server` が通る | extensions/ 9ファイル + config 1ファイル + tests/ 3ファイル |

### フェーズ 2: document 系

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 8.3 | document-server src の ruff 適用 | [x] | `scripts/test.sh --rebuild document-server` が通る | src/ 12ファイル |
| 8.4 | document-server tests の ruff 適用 | [x] | `scripts/test.sh document-server` が通る | tests/ 9ファイル |
| 8.5 | document-mcp src の prettier 適用 | [x] | `scripts/test.sh --rebuild document-mcp` が通る | src/ 15ファイル |
| 8.6 | document-mcp tests の prettier 適用 | [x] | `scripts/test.sh document-mcp` が通る | tests/ 19ファイル |

### フェーズ 3: jupyter-mcp（最大規模）

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 8.7 | jupyter-mcp src の prettier 適用 | [x] | `scripts/test.sh --rebuild jupyter-mcp` が通る | src/ 39ファイル |
| 8.8 | jupyter-mcp tests の prettier 適用 | [x] | `scripts/test.sh jupyter-mcp` が通る | tests/ 41ファイル |

### フェーズ 4: その他

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 8.9 | tests/e2e の prettier 適用 | [x] | 型チェック（`tsc --noEmit`）が通る | 5ファイル |
| 8.10 | scripts/ の ruff 適用 | [x] | スクリプトが正常動作する | Python スクリプト 2ファイル |

---

## Phase 9: ローカル Python 環境の uv 統一

リポジトリクローン後のローカル Python 実行環境をリポジトリルート単一の uv venv に集約する Phase。開発者間・Claude Code セッション間で実行環境の差異が生じないようにし、`python` / `pip` 直叩きを PreToolUse フックで禁止して必ず `uv run` 経由にする。Docker ビルド経路（`Dockerfile`, `jupyter-server/requirements.txt`, `docker-compose.yml`）には一切手を加えない。CI ワークフロー（`.github/workflows/ci.yml`）の `setup-python@v5` + `pip install` 系ジョブは本 Phase の対象外（CI は既にバージョン固定済み）。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 9.1 | ルート venv 導入 + scripts uv 化 + Bash フック | [x] | `uv sync` 後に `scripts/lint.sh` が通り、`python3 -c "print(1)"` の直叩きが PreToolUse フックでブロックされ、`scripts/smoke-test.sh` が Docker 環境に対して成功する | ルート `pyproject.toml`, `.python-version`, `.claude/rules/python-uv.md`, `.claude/hooks/block-direct-python.sh` 新規作成。`scripts/` 配下の `python3` 直叩きを `uv run python` に置換。smoke-test は Bearer 認証ヘッダー同梱修正 |
| 9.2 | mypy / pytest のルート venv 統合 | [x] | `scripts/test.sh document-server` と `scripts/test.sh jupyter-server` が、コンポーネント直下の `.venv` を参照せずにルート venv 経由で通る | ルート `pyproject.toml` の `[dependency-groups] dev` に document-server / jupyter-server の依存・型チェック・テストツールを集約。`scripts/test.sh` の per-component venv 分岐を削除 |
| 9.3 | jupyterlab-ai-sync ビルドのルート venv 統合 | [x] | ルート venv を使った状態で `jupyterlab-ai-sync` の `npm run build` が成功し、labextension アセットが生成される | ルート dev group に `jupyterlab`, `jupyter-packaging`, `setuptools`, `wheel` を追加。`jupyterlab-ai-sync/pyproject.toml`（build backend）は変更しない |
| 9.4 | 初回セットアップスクリプト（uv 検知 + bootstrap） | [x] | clone 直後の環境で `bash scripts/bootstrap.sh` を実行すると、uv 未検出時はインストール手順を案内して exit 1、uv 検出時は `uv sync` と `git config core.hooksPath .githooks` / `git config fetch.prune true` を適用して完了する | `scripts/bootstrap.sh` 新規作成。uv 自動インストールは行わず `curl -LsSf https://astral.sh/uv/install.sh \| sh` コマンドを表示して利用者に委ねる方針（`curl \| sh` のリポジトリ同梱を避ける）。CLAUDE.md の「初回セットアップ」節を `bash scripts/bootstrap.sh` 一行＋補足に置換。**計画作成時は先に `tmp/9.4-plan-notes.md` を読むこと**（9.3 実行時に観測した PATH 反映 / `.env` bootstrap の追加スコープを記載） |

---

## Phase 10: コンテキスト管理の改善

AIエージェントが読み込むコンテキストの削減と、ドキュメント陳腐化の防止（「コードが正」の徹底）を行う Phase。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 10.1 | 完了タスクのアーカイブ構造導入 | [x] | docs/plan・docs/tasks・docs/issues の完了分が archive/ に退避され、現役ファイルに進行中・未着手のみ残る | plan/README.md にアーカイブ規約を明文化。関連コマンド・スキル・ルールの参照更新を含む |
| 10.2 | SSoT 再定義（コードが正）とポインタ化 | [x] | STRUCTURE.md の SSoT 表で実装詳細の正がコードになり、*/CLAUDE.md・README.md のツール/API一覧がコードへのポインタに置き換わる | documentation.md / doc-code-audit スキルの判定基準も同期。ポインタ化により実在しない API 記載などの既存乖離も解消 |
| 10.3 | requirements / api-contracts のスリム化 | [x] | 要件定義と API 仕様から実装詳細（スキーマ・デフォルト値等）が除去され、F番号・Why・受け入れ条件・機械検証可能な一覧表のみ残る | コード照合で乖離を検証しながら実施（計 -3,256 行）。api-contracts.md は 1,709→89 行 |
| 10.4 | ドキュメント整合性の CI 機械検証 | [x] | PR ごとに CI で MCPツール名・エンドポイント・Markdownリンクの整合が検証され、乖離があると FAIL する | scripts/check-docs-consistency.py + ci.yml doc-consistency ジョブ + .githooks/pre-push |
| 10.5 | カスタムコマンドの DRY 化と常時ロード削減 | [x] | commands の重複手順が skills へ抽出され、scripts.md が条件付きロードになる | コミット手順の転記3箇所を commit-and-push スキル参照に置換。scripts.md に paths frontmatter 追加、CLAUDE.md にポインタ行を残置 |

---

## Phase 12: ビルド再現性の確保

同じコミットから同じビルド成果物を得られるよう、バージョン固定の穴を塞ぐ Phase。リファクタリングと独立して先行実施できる quick win。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 12.1 | Docker ベースイメージの digest 固定 | [x] | `docker compose build` が digest 固定のイメージを使用し、異なる日にビルドしても同じベースレイヤーになる | jupyter-server / document-server / postgres |
| 12.2 | Python 依存バージョン統一と JupyterLab 明示固定 | [x] | requirements.txt の pyarrow が uv.lock と一致し、JupyterLab バージョンが明示固定されている | pyarrow==19.0.1→23.0.1 統一、jupyterlab ピン追加 |
| 12.3 | docker-compose 表記の v2 統一 | [x] | `grep -r "docker-compose"` がプロジェクト内でヒットしない（docker compose v2 表記に統一） | bootstrap.sh、CLAUDE.md 類 |
| 12.4 | Node.js バージョンの明示固定 | [x] | .nvmrc が存在し、package.json に engines フィールドがあり、CI と一致する | 全 package.json + .nvmrc |
| 12.5 | jupyterlab-ai-sync ビルドの決定的化 | [x] | Dockerfile と CI で `npm ci` が使用され、`npm install` が使われていない | npm install → npm ci |

---

## Phase 13: npm 依存パッケージの脆弱性修正

npm audit で検出された high/moderate 脆弱性の解消。CI の npm audit (informational) ジョブを pass させ、PR の `mergeStateStatus` が `UNSTABLE` にならないようにする。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 13.1 | npm 依存パッケージの脆弱性修正 | [x] | `npm audit --audit-level=high` が exit 0 で終了する。CI の npm audit (informational) ジョブが pass する | `fast-uri` 3.0.0-3.1.3 (high: host confusion via backslash)、`@hono/node-server` <2.0.5 (moderate: path traversal on Windows, `@modelcontextprotocol/sdk` 経由の間接依存) |
