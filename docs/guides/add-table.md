# テーブル追加手順

新しいテーブルをデータカタログに追加し、分析で利用可能にする手順。

## 概要

PoCでデータを追加する際、以下の2パターンがある。

| パターン | 用途 | execute_sql対応 |
|----------|------|----------------|
| **A: PostgreSQL経由** | SQLで分析したいテーブル | 対応 |
| **B: CSV直接読み込み** | pandasで直接読み込むデータ | 非対応 |

いずれの場合もカタログYAMLの作成が必要。カタログに登録することで、AIがテーブル構造を参照できるようになる。

## 前提条件

- Docker環境が起動済み（`docker-compose up -d`）
- 追加するCSVデータが手元にある（Parquet に変換して利用）

---

## 手順A: PostgreSQL経由（execute_sql対応）

SQLによるデータ分析（`execute_sql` ツール）を使いたい場合はこちら。

### A-1. データファイルを配置

CSVファイルを仮置きディレクトリに配置し、Parquet に変換する。

**Step 1: CSV を仮置き**

```
postgres/data/csv/{ENV}/{テーブル名}.csv
```

- `{ENV}` は `sample` または `production`
- CSVはヘッダ行付き。カラム順はカタログYAMLのカラム定義と合わせる

```csv
column_a,column_b,column_c
value1,value2,value3
```

**Step 2: Parquet に変換**

```bash
scripts/convert-csv-to-parquet.py {ENV}
```

- `postgres/data/csv/{ENV}/*.csv` を読み取り、`postgres/data/{ENV}/*.parquet` に出力
- 既に対応する `.parquet` が存在するテーブルはスキップ（`--force` で再変換）
- 変換後、CSV はクラウドストレージ等に退避してよい

> **注意**: `rebuild.sh` / `switch-env.sh` は CSV → Parquet の自動変換を行わない。Parquet ファイルがない状態でデータロードすると失敗するため、必ず先に `convert-csv-to-parquet.py` を実行すること。

### A-2. カタログYAMLを作成

カタログYAMLを先に作成する。init スクリプトの自動生成（A-3）がカタログYAMLを入力として使うため。

2つのファイルを編集・作成する。

**`document-server/data/{ENV}/catalog/index.yaml` にエントリを追加:**

```yaml
tables_index:
  # ... 既存エントリ ...
  - table_name: {テーブル名}
    display_name: "{表示名}"
    summary: "{テーブルの概要（1行）}"
    category: "{カテゴリ}"
```

`category` は既存の分類（「トランザクション系」「マスタ系」等）に合わせるか、新規カテゴリを作成する。

**`document-server/data/{ENV}/catalog/tables/{テーブル名}.yaml` を新規作成:**

> `summary` と `category` はAPIレスポンス（`TableDetail`）には含まれないが、`index.yaml` と値を揃えて記載しておくと管理しやすい（既存YAMLもこの慣行に従っている）。

```yaml
table_name: {テーブル名}
display_name: {表示名}
summary: "{テーブルの概要（1行）}"
category: {カテゴリ}
description: |
  {テーブルの詳細な説明。}
  {複数行で記載可能。}
data_source:
  type: postgresql
  table: {テーブル名}

columns:
  - name: {カラム名}
    type: {型}
    description: "{カラムの説明}"
    nullable: false
    # 以下はオプション
    # key_type: "{キーの種別}"
    # domain:
    #   master_table: {参照先テーブル}
    #   master_column: {参照先カラム}
    #   label_column: {ラベルカラム}
    # domain:
    #   values:
    #     - value1    # 説明1
    #     - value2    # 説明2
    # notes: |
    #   カラムに関する注意事項
    # examples: ["値1", "値2"]

# オプション
statistics:
  row_count: {概算行数}
  # date_range:
  #   from: "2020-01-01"
  #   to: "2025-12-31"
  # update_frequency: "日次バッチ"

# オプション
# notes_table_level:
#   - "テーブルレベルの注意事項"
```

**カラム定義フィールドの一覧:**

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `name` | Yes | カラム名 |
| `type` | Yes | データ型（`varchar(16)`, `integer`, `date` 等） |
| `description` | Yes | カラムの説明 |
| `nullable` | Yes | NULL許容か（`true`/`false`） |
| `key_type` | No | キーの種別（例: 「統合会員番号」） |
| `domain` | No | 値域定義（マスタ参照 or 値列挙） |
| `notes` | No | カラムに関する注意事項 |
| `examples` | No | 値の例（リスト形式） |

### A-3. `/custom-sync-db` でDB再構築

カタログYAMLから init スクリプトを自動生成し、PostgreSQL を再構築する。

```bash
/custom-sync-db {ENV}
```

このコマンド1つで以下がすべて実行される:

1. `scripts/generate-init-scripts.sh {ENV}` — カタログYAMLからCREATE TABLE文・データ投入コマンドを生成
2. `scripts/switch-env.sh --force-reload {ENV}` — PostgreSQL のボリューム削除・再作成・データ投入（`--force-reload` で既存ボリュームがあっても強制再ロード）
3. `scripts/smoke-test.sh` — スモークテスト

> **注意:** PostgreSQL のデータボリューム（`postgres_data_{ENV}`）は削除して再作成される。ただし環境ごとにボリュームが分離されているため、他環境のデータには影響しない。

<details>
<summary>手動で個別に実行する場合</summary>

```bash
# init スクリプトの生成
scripts/generate-init-scripts.sh {ENV}

# PostgreSQL の再構築（--force-reload でボリューム削除→再構築を強制）
scripts/switch-env.sh --force-reload {ENV}
```

生成されるファイル:
- `postgres/init/{ENV}/create-tables.sql` — カタログYAMLのカラム名・型から生成
- `postgres/init/{ENV}/load-data.py` — Parquet → COPY FROM STDIN でロード（ホスト側から実行）

> 日本語カラム名を含むテーブルは、自動的にダブルクォートで囲まれる。

> 生成後にインデックス追加や制約追加などを手動編集してもよいが、次回の自動生成で上書きされる点に注意。

</details>

### A-4. カタログを反映

document-serverにカタログの再読み込みを指示する。

```bash
curl -X POST http://localhost:3002/admin/reload
```

またはMCPツール経由で `POST /admin/reload` を実行する。

### A-5. 動作確認

以下を確認する:

1. `GET /catalog/index` でテーブル一覧に表示されること
2. `POST /catalog/tables` でテーブル詳細が取得できること
3. `execute_sql` でSQLクエリが実行できること

```bash
# インデックス確認
curl http://localhost:3002/catalog/index | jq .

# 詳細確認
curl -X POST http://localhost:3002/catalog/tables \
  -H "Content-Type: application/json" \
  -d '{"table_names": ["{テーブル名}"]}' | jq .
```

---

## 手順B: CSV直接読み込み（PostgreSQL不使用）

pandasで直接CSVを読み込んで分析する場合はこちら。`execute_sql` ツールでは使えないが、Jupyterノートブック上で `pd.read_csv()` で利用できる。

### B-1. CSVファイルを配置

Jupyterワークスペースの `data/` ディレクトリにCSVを配置する。

```bash
# Jupyterコンテナ内の /home/jovyan/work/data/ に配置
docker cp {ローカルのCSVパス} jupyter-server:/home/jovyan/work/data/{ファイル名}.csv
```

### B-2. カタログYAMLを作成

手順A-2と同様に `index.yaml` へのエントリ追加と、テーブルYAMLの作成を行う。

`data_source` のみ異なる:

```yaml
data_source:
  type: csv
  table: {ファイル名}.csv
```

### B-3. カタログを反映

```bash
curl -X POST http://localhost:3002/admin/reload
```

---

## 注意事項

- **initスクリプトの実行タイミング**: `postgres/init/` 配下のスクリプトはPostgreSQLコンテナの初回起動時（ボリューム作成時）のみ実行される。既存環境にテーブルを追加する場合は、`/custom-sync-db` または `switch-env.sh` でボリュームを再作成する。
- **initスクリプトの環境別管理**: `postgres/init/sample/` と `postgres/init/production/` に分離されている。`production/` は `.gitignore` で git 管理外。ディスパッチャー（`postgres/init/01-init-db.sh`）が `DATA_ENV` に応じて適切な環境のスクリプトを実行する。
- **initスクリプトの自動生成**: `scripts/generate-init-scripts.sh` でカタログ YAML から自動生成される。手動編集は次回の生成で上書きされるため、永続的な変更はカタログ YAML 側で行うこと。
- **データ形式**: PostgreSQL へのデータロードは Parquet 形式で行う。CSV は `postgres/data/csv/{ENV}/` に仮置きし、`scripts/convert-csv-to-parquet.py` で Parquet に変換する。変換後の CSV はクラウドストレージに退避してよい。
- **カラム定義の一致**: カタログYAMLのカラム定義は、実際のテーブル定義（DDL）やデータファイルのカラムと一致させること。AIはカタログ情報を基にSQLを生成するため、不整合があると正しいクエリが生成されない。
- **カテゴリ名**: `index.yaml` の `category` と テーブルYAMLの `category` は同じ値にすること。
