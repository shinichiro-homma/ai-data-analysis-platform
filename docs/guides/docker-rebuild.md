# Docker リビルドガイド

ソースコードやデータを変更した後、環境に正しく反映させるための手順。

## 診断フロー

**上から順にすべての質問をチェックし、該当する操作をすべて実行すること。**
複数の変更を同時に行った場合は、該当するすべてのセクションの操作を組み合わせる。

---

### Q1. CSV ファイルを追加・変更したか？

> 対象: `postgres/data/csv/{ENV}/*.csv`

- **YES** → 以下を実行してから Q2 へ

  ```bash
  scripts/convert-csv-to-parquet.py {ENV}
  # 既存 Parquet も再変換する場合:
  # scripts/convert-csv-to-parquet.py --force {ENV}
  ```

  > **重要**: どのリビルドスクリプトも CSV→Parquet 変換を自動実行しない。必ず手動で先に実行すること。

- **NO** → Q2 へ

---

### Q2. Parquet ファイルを追加・変更したか？

> 対象: `postgres/data/{ENV}/*.parquet`（Q1 で変換した場合も含む）

- **YES** → 以下を実行してから Q3 へ

  ```bash
  scripts/switch-env.sh --force-reload {ENV}
  ```

- **NO** → Q3 へ

---

### Q3. カタログ YAML を変更したか？

> 対象: `document-server/data/{ENV}/catalog/tables/*.yaml`, `index.yaml`

- **YES** → Q3-1 へ
- **NO** → Q4 へ

#### Q3-1. テーブル構造（カラム追加・削除・型変更・新テーブル）を変更したか？

- **YES** → 以下を実行してから Q4 へ

  ```bash
  # 一括実行（推奨）:
  📎 /custom-sync-db {ENV}

  # 手動の場合:
  scripts/generate-init-scripts.sh {ENV}
  scripts/switch-env.sh --force-reload {ENV}
  curl -X POST http://localhost:3002/admin/reload
  scripts/smoke-test.sh
  ```

  > Q2 で `switch-env.sh --force-reload` を既に実行した場合でも、init スクリプトの再生成が必要なため `generate-init-scripts.sh` は省略しないこと。`switch-env.sh --force-reload` は重複実行して問題ない。

- **NO**（メタデータのみ: 説明文、display_name、example 等） → 以下を実行してから Q4 へ

  ```bash
  curl -X POST http://localhost:3002/admin/reload
  ```

---

### Q4. 用語集・ロジック YAML を変更したか？

> 対象: `document-server/data/{ENV}/terms/*.yaml`, `document-server/data/{ENV}/logic/*.yaml`

- **YES** → 以下を実行してから Q5 へ

  ```bash
  curl -X POST http://localhost:3002/admin/reload
  ```

  > Q3 で既に `/admin/reload` を実行済みなら省略可。

- **NO** → Q5 へ

---

### Q5. MCP サーバーのソースコードを変更したか？

> 対象: `jupyter-mcp/src/**/*.ts`, `document-mcp/src/**/*.ts`

- **YES** → Q5-1 へ
- **NO** → Q6 へ

#### Q5-1. npm パッケージ（package.json）も変更したか？

- **YES** →

  ```bash
  scripts/rebuild-mcp.sh --install {server}
  # または: scripts/test.sh --rebuild {server}（リビルド+テスト一括）
  ```

- **NO** →

  ```bash
  scripts/rebuild-mcp.sh {server}
  # または: scripts/test.sh --rebuild {server}（リビルド+テスト一括）
  ```

→ Q6 へ

---

### Q6. Docker コンテナのソースコードを変更したか？

> 対象: `jupyter-server/` または `document-server/` 内のコード

- **YES** → Q6-1 へ
- **NO** → Q7 へ

#### Q6-1. Dockerfile も変更したか？

- **YES** →

  ```bash
  scripts/rebuild.sh {service}
  # キャッシュが効いて変更が反映されない場合:
  # scripts/rebuild.sh --clean
  ```

- **NO** →

  ```bash
  scripts/rebuild.sh {service}
  # または: scripts/test.sh --rebuild {service}（リビルド+テスト一括）
  ```

→ Q7 へ

---

### Q7. docker-compose.yml を変更したか？

- **YES** →

  ```bash
  scripts/rebuild.sh
  # ボリューム名やネットワーク構成を変更した場合:
  # scripts/rebuild.sh --clean
  ```

- **NO** → Q8 へ

---

### Q8. 環境を切り替えたいか？（sample ↔ production）

- **YES** →

  ```bash
  scripts/switch-env.sh {ENV}
  # 強制再ロード: scripts/switch-env.sh --force-reload {ENV}
  ```

- **NO** → 完了

---

## よくあるパターン早見表

| やったこと | 実行するコマンド |
|-----------|----------------|
| MCP の TypeScript を修正 | `scripts/test.sh --rebuild {server}` |
| document-server の Python を修正 | `scripts/test.sh --rebuild document-server` |
| カタログの説明文だけ修正 | `curl -X POST http://localhost:3002/admin/reload` |
| カタログにカラムを追加 | 📎 `/custom-sync-db {ENV}` → `curl -X POST http://localhost:3002/admin/reload` |
| 新テーブル追加（CSV あり） | `convert-csv-to-parquet.py` → 📎 `/custom-sync-db {ENV}` → `/admin/reload` |
| Parquet を差し替え | `scripts/switch-env.sh --force-reload {ENV}` |
| MCP と Docker の両方を修正 | `scripts/rebuild-mcp.sh && scripts/rebuild.sh` |
| 何を変えたか分からない / 全部壊れた | `scripts/clean-rebuild.sh --env {ENV} -y` |

---

## 各スクリプトのカバー範囲

| スクリプト | カバーする | カバーしない |
|-----------|----------|-------------|
| `rebuild-mcp.sh` | MCP の TypeScript ビルド | Docker, DB, カタログ |
| `rebuild.sh` | Docker ビルド+起動, postgres 鮮度自動チェック+再初期化 | MCP ビルド, CSV→Parquet 変換 |
| `switch-env.sh` | 環境切り替え, postgres 再構築, 全サービス再起動 | MCP ビルド, init スクリプト再生成, CSV→Parquet 変換 |
| `generate-init-scripts.sh` | カタログ YAML → SQL/Python 生成 | DB への適用（生成のみ） |
| `convert-csv-to-parquet.py` | CSV → Parquet 変換 | DB への適用, その他一切 |
| `clean-rebuild.sh` | 全削除 → MCP + Docker フルビルド → スモークテスト | CSV→Parquet 変換 |
| `check-freshness.sh` | 全コンポーネントの鮮度診断 | 修正（`--rebuild` 付きなら自動修正） |

---

## なぜ「古いイメージ」が残るのか

Docker には以下の特性がある：

- `docker-compose up -d` は、イメージが既にあれば**再ビルドせずに再利用**する
- `docker-compose build` は**キャッシュが効く**ため、変更が正しく検出されないことがある
- MCP サーバー（jupyter-mcp, document-mcp）は Docker の外で動くため、`npm run build` で `dist/` を更新しないと古いコードのまま動く

## 環境の鮮度チェック

今の環境が最新かどうかを確認する：

```bash
scripts/check-freshness.sh
```

以下のタイムスタンプを比較し、古いものがあれば警告する：

| チェック対象 | 比較内容 |
|-------------|---------|
| jupyter-server | ソースコード vs Docker コンテナ |
| document-server | ソースコード vs Docker コンテナ |
| document-server (data) | カタログ YAML 更新時刻 vs document-server コンテナ起動時刻 |
| postgres (init) | カタログ YAML vs 生成済み init スクリプト |
| postgres (data) | init スクリプト + CSV/Parquet vs postgres コンテナ |
| jupyter-mcp | `src/` vs `dist/` |
| document-mcp | `src/` vs `dist/` |

## やりがちな失敗パターン

| やりがちなこと | なぜダメか |
|--------------|-----------|
| コード変更後に `docker-compose up -d` だけ実行 | イメージが再ビルドされない。古いイメージでコンテナが起動する |
| `docker-compose build` + `up -d` | キャッシュが効いて変更が反映されないことがある |
| MCP のコードを変えて Docker だけリビルド | MCP は Docker の外で動くので `rebuild-mcp.sh` が別途必要 |
| カタログ YAML を変えて Docker だけリビルド | init スクリプトが古いまま。`generate-init-scripts.sh` → `switch-env.sh` が必要 |
| CSV データを更新して postgres を再起動 | init スクリプトはボリューム作成時だけ実行される。`convert-csv-to-parquet.py` で Parquet に変換後、`switch-env.sh --force-reload` でボリューム再作成が必要 |

**ポイント: `docker-compose` を直接使わず、必ず `scripts/` 配下のスクリプトを経由する。**
