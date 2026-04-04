# スクリプトリファレンス

`scripts/` ディレクトリに配置された開発用スクリプトの詳細リファレンス。

---

## 目次

1. [test.sh](#testsh) — テスト実行
2. [rebuild-mcp.sh](#rebuild-mcpsh) — MCP サーバービルド
3. [rebuild.sh](#rebuildsh) — Docker コンテナリビルド
4. [clean-rebuild.sh](#clean-rebuildsh) — 完全クリーンビルド
5. [check-freshness.sh](#check-freshnesssh) — 環境鮮度チェック
6. [smoke-test.sh](#smoke-testsh) — スモークテスト
7. [switch-env.sh](#switch-envsh) — データ環境切り替え
8. [create-test-issue.sh](#create-test-issuesh) — テスト失敗 Issue 起票
9. [manage-known-failures.sh](#manage-known-failuressh) — 既知テスト失敗管理

---

## test.sh

コンポーネントの型チェックとテストを実行する統合テストランナー。

### 構文

```bash
scripts/test.sh [OPTIONS] [COMPONENT...]
```

### コンポーネント

| 名前 | 説明 |
|------|------|
| `jupyter-mcp` | Jupyter MCP サーバー |
| `document-mcp` | Document MCP サーバー |
| `document-server` | Document サーバー |
| `jupyter-server` | Jupyter サーバー |

省略時は全コンポーネントが対象。

### オプション

| オプション | 説明 |
|-----------|------|
| `--typecheck` | 型チェックのみ実行（テストをスキップ） |
| `--test` | テストのみ実行（型チェックをスキップ） |
| `--integration` | 統合テストを実行（Docker 環境が必要） |
| `--rebuild` | 統合テスト前に古いコンポーネントを自動リビルド |
| `--health` | テスト後に `tests/known-failures.json` と照合し、既知障害と新規障害を分類 |

### 動作の流れ

1. **統合テストモード (`--integration`)** の場合:
   - Docker サービス（jupyter-server, document-server）の起動確認
   - `check-freshness.sh` による鮮度チェック（`--rebuild` 付きなら自動リビルド）
   - MCP サーバーのビルド
   - `npm run test:integration` を実行
2. **通常モード** の場合:
   - Docker 起動中なら鮮度チェック（警告のみ）
   - TypeScript: `npm run typecheck` → `npm test`
   - Python: `mypy src/` → `pytest`
3. **`--health` モード**: 失敗を既知障害と照合し、新規障害のみ exit 1

### 使用例

```bash
scripts/test.sh                                    # 全コンポーネント
scripts/test.sh jupyter-mcp                        # jupyter-mcp のみ
scripts/test.sh --typecheck                        # 型チェックのみ
scripts/test.sh --test jupyter-mcp                 # jupyter-mcp のテストのみ
scripts/test.sh --integration jupyter-mcp          # 統合テスト
scripts/test.sh --integration --rebuild            # リビルド後に統合テスト
scripts/test.sh --health jupyter-mcp               # 既知障害と照合
```

---

## rebuild-mcp.sh

MCP サーバー（TypeScript）のビルドを行う。

### 構文

```bash
scripts/rebuild-mcp.sh [OPTIONS] [SERVER...]
```

### 対象サーバー

| 名前 | 説明 |
|------|------|
| `jupyter-mcp` | Jupyter MCP サーバー |
| `document-mcp` | Document MCP サーバー |

省略時は全 MCP サーバーが対象。

### オプション

| オプション | 説明 |
|-----------|------|
| `--install` | `npm install` を実行してからビルド |
| `--clean` | `dist/` を削除してからクリーンビルド |
| `--check` | 型チェックのみ（ビルドしない） |

### 動作の流れ

1. `--install`: `npm install` を実行
2. `--clean`: `dist/` ディレクトリを削除
3. `--check`: `npm run typecheck` のみ実行、または `npm run build` を実行

### 使用例

```bash
scripts/rebuild-mcp.sh                        # 全 MCP サーバーをビルド
scripts/rebuild-mcp.sh jupyter-mcp            # jupyter-mcp のみ
scripts/rebuild-mcp.sh --install              # npm install + ビルド
scripts/rebuild-mcp.sh --clean                # クリーンビルド
scripts/rebuild-mcp.sh --check                # 型チェックのみ
```

---

## rebuild.sh

Docker コンテナのリビルドと起動を行う。

### 構文

```bash
scripts/rebuild.sh [OPTIONS] [SERVICE...]
```

### 対象サービス

| 名前 | 説明 |
|------|------|
| `jupyter-server` | Jupyter サーバー |
| `document-server` | Document サーバー |
| `postgres` | PostgreSQL |

省略時は全サービスが対象。

### オプション

| オプション | 説明 |
|-----------|------|
| `--clean` | `--no-cache` で完全リビルド。postgres は常に再初期化 |
| `--reset` | ボリューム（`postgres_data_{ENV}`, `jupyter_work`）も削除して完全初期化。**データが消える**ため確認プロンプトあり |
| `--verify` | リビルド後に `smoke-test.sh` を自動実行 |
| `--down-only` | コンテナ停止のみ（リビルドしない） |

### 動作の流れ

- **`--down-only`**: `docker compose down` で停止して終了
- **`--reset`**: 確認プロンプト → `docker compose down --remove-orphans` → 環境別ボリューム `postgres_data_{ENV}` + `jupyter_work` 削除 → `docker compose build --no-cache` → `docker compose up -d` → `run_load_data` でデータロード
- **通常**: `docker compose build` → postgres 鮮度チェック（カタログ YAML・init スクリプト・CSV/Parquet の更新時刻を比較し、古ければ自動再初期化 + `run_load_data`） → `docker compose up -d` → コンテナステータス表示
- **`--clean`**: `docker compose build --no-cache` → postgres は常に再初期化（`run_load_data` 含む） → `docker compose up -d`
- **`--verify`**: リビルド後に 5 秒待機 → `smoke-test.sh` 実行

> **postgres 鮮度チェック**: 通常モードでは以下を自動判定する。
> 1. カタログ YAML が init スクリプトより新しい → `generate-init-scripts.sh` 実行後に再初期化
> 2. init スクリプト・データファイルが postgres コンテナより新しい → 再初期化
> 3. `postgres` を明示指定した場合は常に再初期化

### 使用例

```bash
scripts/rebuild.sh                          # 全サービスをリビルド＆起動
scripts/rebuild.sh jupyter-server           # jupyter-server のみ
scripts/rebuild.sh --clean                  # キャッシュなしで完全リビルド
scripts/rebuild.sh --reset                  # 全削除して初期化
scripts/rebuild.sh --verify                 # リビルド後にスモークテスト
scripts/rebuild.sh --down-only              # コンテナ停止のみ
```

---

## clean-rebuild.sh

Docker コンテナ・イメージ・ボリュームを全削除し、MCP サーバーと Docker をクリーンビルドして動作確認まで行う。

### 構文

```bash
scripts/clean-rebuild.sh [OPTIONS]
```

### オプション

| オプション | 説明 |
|-----------|------|
| `--env ENV` | データ環境を指定（`sample` \| `production`）。省略時は `.env` の `DATA_ENV` 値を使用 |
| `--skip-mcp` | MCP サーバーのビルドをスキップ |
| `--skip-smoke` | スモークテストをスキップ |
| `--keep-volumes` | ボリューム（`postgres_data_{ENV}`, `jupyter_work`）を保持 |
| `-y, --yes` | 確認プロンプトをスキップ |

### 動作の流れ

1. `.env` の `DATA_ENV` を指定環境に更新
2. Docker コンテナ停止 + ボリューム削除（環境別ボリューム `postgres_data_{ENV}` + レガシーボリューム。`--keep-volumes` で保持可）
3. プロジェクトの Docker イメージ削除 + dangling イメージ・ビルドキャッシュ・orphaned ボリュームの掃除
4. MCP サーバー（jupyter-mcp, document-mcp）のクリーンビルド（`--skip-mcp` でスキップ可）
5. Docker イメージのビルド（`--no-cache`）
6. Docker コンテナ起動（postgres init スクリプトがコンテナ内で自動実行される）
7. ヘルスチェック待機（最大 120 秒）
8. スモークテスト実行（`--skip-smoke` でスキップ可）

### 使用例

```bash
scripts/clean-rebuild.sh                        # 完全クリーンビルド（.env の環境を使用）
scripts/clean-rebuild.sh --env sample -y        # sample 環境で確認なし実行
scripts/clean-rebuild.sh --env production       # production 環境で実行
scripts/clean-rebuild.sh --keep-volumes         # DB データを保持してリビルド
scripts/clean-rebuild.sh --skip-smoke           # スモークテストなし
```

---

## check-freshness.sh

ソースコードと Docker イメージ/ビルド成果物のタイムスタンプを比較し、環境が最新かどうかを検証する。

### 構文

```bash
scripts/check-freshness.sh [OPTIONS]
```

### オプション

| オプション | 説明 |
|-----------|------|
| `--strict` | 古いコンポーネントがある場合 exit 1 で終了 |
| `--rebuild` | 古いコンポーネントを自動リビルド |

### チェック対象

| コンポーネント | 比較内容 |
|---------------|---------|
| `jupyter-server` | Docker コンテナの作成時刻 vs `jupyter-server/` 配下のソースファイル |
| `document-server` | Docker コンテナの作成時刻 vs `document-server/` 配下のソースファイル |
| `document-server (data)` | カタログ YAML (`document-server/data/{ENV}/`) の更新時刻 vs document-server コンテナ起動時刻 |
| `postgres (init)` | カタログ YAML vs 生成済み init スクリプト (`postgres/init/{ENV}/`) |
| `postgres (data)` | init スクリプト + CSV/Parquet (`postgres/data/{ENV}/`) vs postgres コンテナ作成時刻 |
| `jupyter-mcp` | `dist/*.js` の更新時刻 vs `src/*.ts` の更新時刻 |
| `document-mcp` | `dist/*.js` の更新時刻 vs `src/*.ts` の更新時刻 |

### 動作の流れ

1. Docker サービス（起動中のみ）の鮮度チェック
2. カタログ YAML・postgres データの鮮度チェック
3. MCP サーバーのビルド成果物の鮮度チェック
4. 古いコンポーネントがある場合:
   - デフォルト: 警告を表示
   - `--strict`: exit 1
   - `--rebuild`: 以下の自動修正を実行

#### `--rebuild` 時の自動修正アクション

| STALE コンポーネント | 自動修正 |
|---------------------|---------|
| `jupyter-server` / `document-server` | `docker compose build` + `docker compose up -d` |
| `jupyter-mcp` / `document-mcp` | `npm run build` |
| `postgres (init)` | `generate-init-scripts.sh` 実行 → `switch-env.sh --force-reload -y` で DB 再構築 |
| `postgres (data)` | `switch-env.sh --force-reload -y` で DB 再初期化 |
| `document-server (data)` | `docker compose restart document-server` |

> **注意**: `postgres (init)` と `postgres (data)` が同時に STALE の場合、`switch-env.sh` は1回のみ実行される。

### 使用例

```bash
scripts/check-freshness.sh                  # 警告のみ
scripts/check-freshness.sh --strict         # 古い場合は exit 1
scripts/check-freshness.sh --rebuild        # 古い場合は自動リビルド
```

---

## smoke-test.sh

Docker 環境の主要フローを curl ベースで軽量にテストする。

### 構文

```bash
scripts/smoke-test.sh
```

### テスト項目

| # | テスト | 内容 |
|---|--------|------|
| 1 | サービス疎通確認 | jupyter-server (`/api/status`) と document-server (`/health`) への接続 |
| 2 | ノートブック作成 | ワークスペースディレクトリ作成 → ノートブックファイル作成 |
| 3 | コード実行 | カーネル起動 → `print("smoke_test_ok")` 実行 → stdout 検証 |
| 4 | SQL 実行（構造チェック） | `data/` ディレクトリの作成可否で書き込み権限を確認 |
| 5 | カタログ参照 | `/catalog/index` と `/glossary/index` からデータ取得 |

### 動作の流れ

1. `.env` から環境変数（`JUPYTER_SERVER_URL`, `DOCUMENT_SERVER_URL`, `JUPYTER_TOKEN`）を読み込み
2. `check-freshness.sh` を実行（警告のみ）
3. 5 つのテスト項目を順次実行
4. テスト中に作成したリソース（ワークスペース、カーネルセッション）は終了時に自動クリーンアップ
5. 結果サマリー（PASS / TOTAL / FAIL）を表示

### 使用例

```bash
scripts/smoke-test.sh                       # スモークテスト実行
```

---

## switch-env.sh

データ環境（sample / production）を切り替える。環境別ボリューム（`postgres_data_sample` / `postgres_data_production`）を管理し、必要に応じて PostgreSQL を再構築する。

### 構文

```bash
scripts/switch-env.sh [OPTIONS] <ENV>
```

### 環境

| 名前 | 説明 |
|------|------|
| `sample` | サンプルデータ環境（デフォルト） |
| `production` | 本番データ環境 |

### オプション

| オプション | 説明 |
|-----------|------|
| `-y, --yes` | 確認プロンプトをスキップ。ボリュームが存在する場合は再ロードせずサービス再起動のみ |
| `--force-reload` | データを強制的に再ロード（ボリューム削除→再構築）。確認プロンプトなし |

### 動作の流れ

1. `.env` の `DATA_ENV` を指定環境に書き換え
2. **スキップ判定**: 指定環境のボリューム `postgres_data_{ENV}` が既に存在するかチェック
   - **`--force-reload` 指定時**: 常にフルリロード（ステップ 3 へ）
   - **ボリューム存在 + `-y` 指定時**: 再ロードをスキップ（ステップ 6 へ）
   - **ボリューム存在 + インタラクティブ**: 「データに更新はありますか？ [y/N]」を確認。N ならスキップ（ステップ 6 へ）
   - **ボリューム未存在**: フルリロード（ステップ 3 へ）
3. **フルリロード**: 確認プロンプト（`-y` / `--force-reload` でスキップ可）
4. postgres, document-server, jupyter-server を停止し、`postgres_data_{ENV}` ボリュームを削除
5. postgres を起動 → ヘルスチェック待機（最大 30 秒） → DB 初期化待機（sample: 60 秒、production: 120 秒） → `run_load_data` でホスト側から Parquet データをロード
6. **サービス再起動**: document-server を起動 → ヘルスチェック待機（最大 30 秒）、jupyter-server を起動 → ヘルスチェック待機（最大 60 秒）
7. Docker ゴミ掃除（dangling イメージ・ボリューム）

**注意**: `jupyter_work` ボリューム（ワークスペース）は保持される。環境ごとにボリュームが分離されているため、環境を切り替えても他環境のデータは消えない。

### 使用例

```bash
scripts/switch-env.sh production                # 本番データに切り替え（ボリューム存在時は確認あり）
scripts/switch-env.sh sample                    # サンプルデータに切り替え
scripts/switch-env.sh -y production             # 確認なし（ボリューム存在時は再ロードしない）
scripts/switch-env.sh --force-reload production  # 強制再ロード（ボリューム削除→再構築）
```

---

## create-test-issue.sh

テスト失敗の GitHub Issue を作成する。`gh` CLI を使用。

### 構文

```bash
scripts/create-test-issue.sh --component COMP --test-name NAME [OPTIONS]
```

### 必須オプション

| オプション | 説明 |
|-----------|------|
| `--component COMP` | コンポーネント名 |
| `--test-name NAME` | テスト名 |

### 任意オプション

| オプション | 説明 |
|-----------|------|
| `--file FILE` | テストファイルパス |
| `--reason REASON` | 失敗の理由 |
| `--task TASK` | 関連タスク番号 |
| `--add-known` | Issue 作成後に `known-failures.json` にも自動追加 |

### 動作の流れ

1. Issue 本文を構築（コンポーネント、テスト名、理由、関連タスクを含む）
2. `gh issue create` で Issue を作成（ラベル: `test-failure`）
3. `--add-known` 指定時: `manage-known-failures.sh add` で既知障害にも登録

### 使用例

```bash
# Issue のみ作成
scripts/create-test-issue.sh --component jupyter-mcp --test-name "session > create" --reason "API変更に未追従"

# Issue 作成 + 既知障害登録
scripts/create-test-issue.sh --component jupyter-mcp --test-name "session > create" --add-known
```

---

## manage-known-failures.sh

既知テスト失敗（`tests/known-failures.json`）の CRUD 管理を行う。

### 構文

```bash
scripts/manage-known-failures.sh COMMAND [OPTIONS]
```

### コマンド

#### `list` — 一覧表示

```bash
scripts/manage-known-failures.sh list
```

登録済みの既知障害を ID、コンポーネント、フェーズ、テスト名、理由とともに一覧表示する。

#### `add` — エントリ追加

```bash
scripts/manage-known-failures.sh add --component COMP --test-name NAME --reason REASON [OPTIONS]
```

| オプション | 必須 | 説明 |
|-----------|------|------|
| `--component COMP` | Yes | コンポーネント名 |
| `--test-name NAME` | Yes | テスト名 |
| `--reason REASON` | Yes | 既知である理由 |
| `--phase PHASE` | No | `test` または `typecheck`（デフォルト: `test`） |
| `--file FILE` | No | テストファイルの相対パス |
| `--issue N` | No | GitHub Issue 番号 |
| `--task T` | No | PLAN.md のタスク番号 |

ID は `kf-001` 形式で自動採番される。

#### `remove` — エントリ削除

```bash
scripts/manage-known-failures.sh remove --id ID
```

指定 ID のエントリを削除する。

#### `check` — 既知障害の存在確認

```bash
scripts/manage-known-failures.sh check COMPONENT
```

指定コンポーネントに既知障害があれば exit 0、なければ exit 1 を返す。`test.sh --health` から内部的に利用される。

### 使用例

```bash
scripts/manage-known-failures.sh list
scripts/manage-known-failures.sh add --component jupyter-mcp --test-name "session > create" --reason "タスク8で対応予定"
scripts/manage-known-failures.sh remove --id kf-001
scripts/manage-known-failures.sh check jupyter-mcp
```

---

## 共通ライブラリ (common.sh)

`scripts/lib/common.sh` は各スクリプトから `source` される共通処理モジュール。

### 主要な関数

| 関数 | 概要 |
|------|------|
| `validate_env` | 環境名のバリデーション（`sample` / `production`） |
| `read_data_env` | `.env` から `DATA_ENV` を読み取り |
| `set_data_env_in_dotenv` | `.env` の `DATA_ENV` を書き換え |
| `run_load_data` | `postgres/init/{ENV}/load-data.py` を実行し、ホスト側から Parquet データを PostgreSQL にロード |
| `get_postgres_volume_name` | 環境別ボリューム名 `postgres_data_{ENV}` を返す |
| `postgres_volume_exists` | 指定環境のボリュームが存在するか確認 |
| `remove_postgres_volume` | 指定環境のボリュームを削除 |
| `remove_legacy_postgres_volume` | 旧命名規則（`{project}_postgres_data`）のボリュームを削除 |
| `wait_for_postgres_ready` | PostgreSQL プロセスの起動を待機 |
| `wait_for_db_init` | DB 初期化（テーブル作成）完了を待機 |
| `wait_for_http_service` | HTTP サービスの起動を待機 |
| `prune_docker_garbage` | dangling イメージ・ビルドキャッシュ・orphaned ボリュームを削除 |

---

## スクリプト間の連携

```
test.sh --integration --rebuild
  └── check-freshness.sh --rebuild    ← 鮮度チェック＆自動リビルド
  └── npm run test:integration        ← 統合テスト実行

test.sh --health
  └── tests/known-failures.json       ← 既知障害と照合

rebuild.sh --verify
  └── docker compose build/up         ← リビルド
  └── postgres 鮮度チェック           ← YAML/init/データの更新時刻を比較
  │   └── generate-init-scripts.sh    ← init スクリプトが古い場合
  │   └── reinitialize_postgres       ← ボリューム削除→再起動→run_load_data
  └── smoke-test.sh                   ← スモークテスト
      └── check-freshness.sh          ← 鮮度チェック（警告のみ）

create-test-issue.sh --add-known
  └── gh issue create                 ← Issue 起票
  └── manage-known-failures.sh add    ← 既知障害登録

clean-rebuild.sh --env sample
  └── .env DATA_ENV 更新              ← 環境設定
  └── docker compose down             ← コンテナ停止
  └── ボリューム削除                  ← postgres_data_{ENV} + レガシーボリューム
  └── MCP クリーンビルド              ← jupyter-mcp, document-mcp
  └── docker compose build --no-cache ← Docker ビルド
  └── docker compose up -d            ← コンテナ起動（init スクリプト自動実行）
  └── ヘルスチェック待機              ← 各サービスの ready 確認
  └── smoke-test.sh                   ← スモークテスト

switch-env.sh
  └── スキップ判定                    ← ボリューム存在チェック
  │   ├── ボリューム存在 + -y         → サービス再起動のみ
  │   ├── ボリューム存在              → 「データに更新はありますか？」確認
  │   └── ボリューム未存在            → フルリロード
  └── フルリロード時
  │   └── ボリューム削除              ← postgres_data_{ENV}
  │   └── postgres 起動               ← ヘルスチェック + DB 初期化待機
  │   └── run_load_data               ← ホスト側から Parquet データロード
  └── サービス再起動                  ← document-server, jupyter-server
  └── ヘルスチェック待機              ← 各サービスの ready 確認

check-freshness.sh --rebuild
  └── Docker サービスの鮮度チェック   ← jupyter-server, document-server
  └── カタログ YAML データの鮮度      ← document-server (data)
  └── postgres init/data の鮮度       ← 古ければ switch-env.sh --force-reload -y
  └── MCP ビルド成果物の鮮度          ← jupyter-mcp, document-mcp
```
